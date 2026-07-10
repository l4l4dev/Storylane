import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensureCurrentIteration } from "@/app/projects/[id]/board/actions";
import { calculateVelocity } from "@/lib/utils/velocity";
import { InlineCreatePanel } from "@/components/features/projects/inline-create-panel";
import type { ProjectCardData } from "@/components/features/projects/project-card";
import { ProjectGrid } from "@/components/features/projects/project-grid";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

/**
 * Rolls over one tracker project's current iteration, swallowing any
 * failure from `ensureCurrentIteration` (e.g. a transient DB error, or a
 * genuinely broken iteration state on that one project).
 *
 * Exported at module scope — rather than nested in the page component like
 * this file's other `fetchX` helpers — so it can be unit tested directly,
 * and so a batched `Promise.all` over many projects never rejects because
 * of a single project's rollover failure (see final code review finding on
 * this file: previously the whole `/dashboard` page 500'd for every
 * project when even one project's rollover failed). The project's card
 * simply falls back to whatever iteration data was already fetched
 * (possibly stale by one rollover) instead of crashing the page.
 */
/**
 * Tracker projects that should be rolled over on this page load — excludes
 * archived ones. Without this, visiting `/dashboard` would call
 * `ensureCurrentIteration` on every tracker project unconditionally,
 * creating a new empty iteration in an archived project each time anyone
 * viewed the page — exactly the app-driven write this task's read-only
 * scoping (Move/Copy checks + this UI's own gating) is supposed to prevent
 * (fable-advisor finding, TASK-8).
 */
export function projectsNeedingRollover<T extends { archived_at: string | null }>(
  trackerProjects: readonly T[],
): T[] {
  return trackerProjects.filter((p) => p.archived_at === null);
}

export async function rolloverIterationSafely(projectId: string): Promise<void> {
  try {
    await ensureCurrentIteration(projectId);
  } catch {
    // Intentionally ignored — see comment above.
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ invite_failed?: string }>;
}) {
  const { invite_failed } = await searchParams;
  // TASK-25 follow-up: only render the banner for a genuine positive
  // integer — a crafted/garbled query param renders nothing instead of a
  // nonsensical message (React already escapes it, so this is a validity
  // guard, not an XSS fix).
  const inviteFailedCount = invite_failed ? Number.parseInt(invite_failed, 10) : NaN;
  const showInviteFailedBanner = Number.isInteger(inviteFailedCount) && inviteFailedCount > 0;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, description, workflow_mode, created_at, updated_at, archived_at, velocity_window")
    .order("updated_at", { ascending: false });

  const trackerProjects = (projects ?? []).filter((p) => p.workflow_mode === "tracker");
  const freeProjects = (projects ?? []).filter((p) => p.workflow_mode === "free");

  // Lazily rolls over each tracker project's current iteration before
  // reading it (spec/velocity.md "Automatic scheduling & rollover") — same
  // rule the board page applies, just batched across projects here. Uses
  // the failure-swallowing wrapper (not ensureCurrentIteration directly) so
  // one project's rollover failure can't 500 the whole page for everyone.
  await Promise.all(projectsNeedingRollover(trackerProjects).map((p) => rolloverIterationSafely(p.id)));

  type IterationRow = { number: number; velocity: number | null; state: string };
  type MemberRow = {
    user_id: string;
    role: string;
    is_favorite: boolean;
    profiles: { display_name: string; avatar_url: string | null } | null;
  };

  async function fetchIterations(projectId: string): Promise<readonly [string, IterationRow[]]> {
    const { data } = await supabase
      .from("iterations")
      .select("number, velocity, state")
      .eq("project_id", projectId)
      .order("number", { ascending: false });
    return [projectId, data ?? []] as const;
  }

  async function fetchColumnCount(projectId: string): Promise<readonly [string, number]> {
    const { count } = await supabase
      .from("custom_statuses")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    return [projectId, count ?? 0] as const;
  }

  async function fetchOpenCardCount(projectId: string): Promise<readonly [string, number]> {
    const { count } = await supabase
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("completed_at", null);
    return [projectId, count ?? 0] as const;
  }

  async function fetchMembers(projectId: string): Promise<readonly [string, MemberRow[]]> {
    const { data } = await supabase
      .from("project_members")
      .select("user_id, role, is_favorite, profiles(display_name, avatar_url)")
      .eq("project_id", projectId);
    return [projectId, data ?? []] as const;
  }

  const [iterationsByProject, columnCountsByProject, openCardCountsByProject, membersByProject] =
    await Promise.all([
      Promise.all(trackerProjects.map((p) => fetchIterations(p.id))),
      Promise.all(freeProjects.map((p) => fetchColumnCount(p.id))),
      Promise.all(freeProjects.map((p) => fetchOpenCardCount(p.id))),
      Promise.all((projects ?? []).map((p) => fetchMembers(p.id))),
    ]);

  const iterationsById = new Map(iterationsByProject);
  const columnCountById = new Map(columnCountsByProject);
  const openCardCountById = new Map(openCardCountsByProject);
  const membersById = new Map(membersByProject);

  const cards: ProjectCardData[] = (projects ?? []).map((project) => {
    const memberRows = membersById.get(project.id) ?? [];
    const members = memberRows.map((m) => ({
      userId: m.user_id,
      displayName: m.profiles?.display_name ?? "Unknown",
      avatarUrl: m.profiles?.avatar_url ?? null,
    }));
    const myMembership = memberRows.find((m) => m.user_id === user?.id);
    const isOwner = myMembership?.role === "owner";
    const isFavorite = myMembership?.is_favorite ?? false;

    if (project.workflow_mode === "tracker") {
      const iterations = iterationsById.get(project.id) ?? [];
      const current = iterations.find((it) => it.state !== "done") ?? null;
      const done = iterations.filter((it) => it.state === "done");
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        workflowMode: "tracker",
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        archivedAt: project.archived_at,
        members,
        isOwner,
        isFavorite,
        currentIterationNumber: current?.number ?? null,
        velocity: calculateVelocity(done, project.velocity_window),
      };
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      workflowMode: "free",
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      archivedAt: project.archived_at,
      members,
      isOwner,
      isFavorite,
      columnCount: columnCountById.get(project.id) ?? 0,
      openCardCount: openCardCountById.get(project.id) ?? 0,
    };
  });

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">Account settings</Link>
          </Button>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {showInviteFailedBanner && (
        <p className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Project created, but {inviteFailedCount} invite{inviteFailedCount === 1 ? "" : "s"} could not be sent.
          Invite them from Project settings instead.
        </p>
      )}

      <div className="mb-6">
        <InlineCreatePanel />
      </div>

      <ProjectGrid projects={cards} />
    </main>
  );
}
