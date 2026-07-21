import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { projectsNeedingRollover, rolloverIterationSafely } from "@/lib/supabase/rollover";
import { velocityRate } from "@storylane/core";
import { InlineCreatePanel } from "@/components/features/projects/inline-create-panel";
import { InviteFailedBanner, parseInviteFailedCount } from "@/components/features/projects/invite-failed-banner";
import type { ProjectCardData } from "@/components/features/projects/project-card";
import { ProjectGrid } from "@/components/features/projects/project-grid";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ invite_failed?: string; new?: string }>;
}) {
  const { invite_failed, new: openCreate } = await searchParams;
  // Only render the banner for a genuine positive integer — a
  // crafted/garbled query param renders nothing instead of a
  // nonsensical message (React already escapes it, so this is a validity
  // guard, not an XSS fix).
  const inviteFailedCount = parseInviteFailedCount(invite_failed);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Hide the viewer's OWN personal project ("My Tasks", TASK-103): it lives
  // in My Work, not the projects list. Scoped to `created_by = me` so a
  // personal project the viewer was invited to (someone else's) still shows
  // for them — see doc-11 D1.
  const personalFilter = user ? `is_personal.eq.false,created_by.neq.${user.id}` : "is_personal.eq.false";
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, description, created_at, updated_at, archived_at, velocity_window")
    .or(personalFilter)
    .order("updated_at", { ascending: false });

  // Lazily rolls over each tracker project's current iteration before
  // reading it (spec/velocity.md "Automatic scheduling & rollover") — same
  // rule the board page applies, just batched across projects here. Uses
  // the failure-swallowing wrapper (not ensureCurrentIteration directly) so
  // one project's rollover failure can't 500 the whole page for everyone.
  await Promise.all(projectsNeedingRollover(projects ?? []).map((p) => rolloverIterationSafely(p.id)));

  type IterationRow = {
    number: number;
    velocity: number | null;
    capacity: number | null;
    state: string;
    skipped: boolean;
  };
  type MemberRow = {
    user_id: string;
    role: string;
    is_favorite: boolean;
    profiles: { display_name: string; avatar_url: string | null } | null;
  };

  async function fetchIterations(projectId: string): Promise<readonly [string, IterationRow[]]> {
    const { data } = await supabase
      .from("iterations")
      .select("number, velocity, capacity, state, skipped")
      .eq("project_id", projectId)
      .order("number", { ascending: false });
    return [projectId, data ?? []] as const;
  }

  async function fetchMembers(projectId: string): Promise<readonly [string, MemberRow[]]> {
    const { data } = await supabase
      .from("project_members")
      .select("user_id, role, is_favorite, profiles(display_name, avatar_url)")
      .eq("project_id", projectId);
    return [projectId, data ?? []] as const;
  }

  const [iterationsByProject, membersByProject] = await Promise.all([
    Promise.all((projects ?? []).map((p) => fetchIterations(p.id))),
    Promise.all((projects ?? []).map((p) => fetchMembers(p.id))),
  ]);

  const iterationsById = new Map(iterationsByProject);
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

    const iterations = iterationsById.get(project.id) ?? [];
    const current = iterations.find((it) => it.state !== "done") ?? null;
    // velocityRate applies the skipped / capacity-0 window filters itself.
    const done = iterations.filter((it) => it.state === "done");
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      archivedAt: project.archived_at,
      members,
      isOwner,
      isFavorite,
      currentIterationNumber: current?.number ?? null,
      velocityRate: velocityRate(done, project.velocity_window),
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

      {inviteFailedCount !== null && <InviteFailedBanner count={inviteFailedCount} />}

      <div className="mb-6">
        <InlineCreatePanel defaultOpen={openCreate === "1"} />
      </div>

      <ProjectGrid projects={cards} />
    </main>
  );
}
