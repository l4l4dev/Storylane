import { addDays, type StateCategory } from "@storylane/core";
import { createClient } from "@/lib/supabase/server";
import { rolloverIterationSafely } from "@/lib/supabase/rollover";
import { utcTodayKey } from "@/lib/utils/format";
import type { MyWorkProject } from "@/lib/utils/my-work";
import { pointScaleValues, storyStateBadge } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import {
  MyWorkSections,
  type MyWorkActiveItem,
  type MyWorkDoneItem,
} from "@/components/features/my-work/my-work-sections";
import type { MyWorkRowData } from "@/components/features/my-work/my-work-row";
import { MyWorkQuickAdd } from "@/components/features/my-work/my-work-quick-add";

// How far back the Done section reaches (doc-12 Thread A) — recent completions
// only; full history is each project's Iterations page.
const DONE_WINDOW_DAYS = 7;

// Cross-project personal view (spec/screens.md "My Work"): the signed-in
// user's assigned, non-Icebox stories, split into Todo / Doing / Today /
// Done (doc-12 Thread A). This server component fetches and shapes the rows;
// MyWorkSections (client) holds the "only current iteration" toggle and does
// the section split + render.
export default async function MyWorkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS already scopes this to the signed-in user's memberships.
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, name, is_personal, created_by")
    .is("archived_at", null);
  const projects: MyWorkProject[] = (projectRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    // TASK-103: the real flag, scoped to the viewer's own personal project —
    // an invited member of someone else's personal project must not have it
    // treated as their own.
    isPersonal: p.is_personal && p.created_by === user?.id,
  }));
  const projectIds = projects.map((p) => p.id);
  const personalProjects = projects.filter((p) => p.isPersonal);
  // The common case of exactly one personal project gets its own draft card
  // (doc-8 §10) — known up front so its data can be fetched alongside
  // everything else below instead of as a second, sequential round trip.
  const soloPersonalProject = personalProjects.length === 1 ? personalProjects[0] : null;

  // Roll over EVERY project's current iteration before reading it (doc-12:
  // the current-iteration filter + Today membership now depend on all
  // projects being fresh, not just personal ones) — same idempotent,
  // failure-swallowing pattern the dashboard uses (spec/velocity.md
  // "Automatic scheduling & rollover").
  await Promise.all(projects.map((p) => rolloverIterationSafely(p.id)));

  // An explicit UTC timestamp (not a bare date) so the comparison below is
  // unambiguous regardless of the DB session's timezone setting — a bare
  // "YYYY-MM-DD" literal would be cast to timestamptz using that session
  // timezone, not necessarily UTC. Built from imported helpers, not an
  // inline Date.now(), which the RSC purity rule forbids during render.
  const doneSince = `${addDays(utcTodayKey(), -DONE_WINDOW_DAYS)}T00:00:00.000Z`;

  const [
    { data: statesRows },
    { data: storyRows },
    { data: pinRows },
    { data: iterationRows },
    { data: soloEpics },
    { data: soloLabels },
    { data: soloMembers },
    { data: soloProject },
  ] = await Promise.all([
    supabase
      .from("project_states")
      .select("id, project_id, name, action_label, category, position, created_at")
      .in("project_id", projectIds),
    user
      ? supabase
          .from("stories")
          .select("id, project_id, number, title, story_type, state_id, points, iteration_id, position, completed_at")
          .eq("assignee_id", user.id)
          .not("state_id", "is", null)
          // Active stories (completed_at null) + recent completions only —
          // old done work is the Iterations page's job, not this list's.
          .or(`completed_at.is.null,completed_at.gte.${doneSince}`)
      : Promise.resolve({ data: null }),
    user
      ? supabase.from("story_pins").select("story_id").eq("user_id", user.id)
      : Promise.resolve({ data: null }),
    // One batched query for every project's latest non-done iteration,
    // instead of one query per project — the per-project "current" id is
    // picked out client-side below (first row per project_id, since this
    // is ordered project_id asc, number desc).
    supabase
      .from("iterations")
      .select("id, project_id")
      .in("project_id", projectIds)
      .neq("state", "done")
      .order("project_id", { ascending: true })
      .order("number", { ascending: false }),
    soloPersonalProject
      ? supabase.from("epics").select("id, name").eq("project_id", soloPersonalProject.id).order("position")
      : Promise.resolve({ data: null }),
    soloPersonalProject
      ? supabase.from("labels").select("id, name").eq("project_id", soloPersonalProject.id).order("name")
      : Promise.resolve({ data: null }),
    soloPersonalProject
      ? supabase
          .from("project_members")
          .select("user_id, profiles(display_name, is_agent)")
          .eq("project_id", soloPersonalProject.id)
      : Promise.resolve({ data: null }),
    soloPersonalProject
      ? supabase.from("projects").select("point_scale, custom_points").eq("id", soloPersonalProject.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const iterationByProject = new Map<string, string>();
  for (const row of iterationRows ?? []) {
    if (!iterationByProject.has(row.project_id)) iterationByProject.set(row.project_id, row.id);
  }
  const currentIterationEntries: ReadonlyArray<readonly [string, string | null]> = projectIds.map(
    (id) => [id, iterationByProject.get(id) ?? null] as const,
  );

  const statesByProject = new Map<string, ProjectState[]>();
  for (const state of (statesRows ?? []) as ProjectState[]) {
    const bucket = statesByProject.get(state.project_id);
    if (bucket) bucket.push(state);
    else statesByProject.set(state.project_id, [state]);
  }
  const categoryByStateId = new Map((statesRows ?? []).map((s) => [s.id, s.category as StateCategory]));
  const pinnedStoryIds = new Set((pinRows ?? []).map((p) => p.story_id));
  const projectIdSet = new Set(projectIds);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  type StoryRow = NonNullable<typeof storyRows>[number];
  function toRowData(raw: StoryRow): MyWorkRowData {
    // visibleStories (below) is pre-filtered to projectIdSet, which is built
    // from this same projects array — the lookup always hits.
    const project = projectById.get(raw.project_id)!;
    return {
      id: raw.id,
      number: raw.number,
      title: raw.title,
      storyType: raw.story_type,
      points: raw.points,
      projectId: raw.project_id,
      projectName: project.name,
      stateBadge: storyStateBadge(raw.state_id, statesByProject.get(raw.project_id) ?? []),
      pinned: pinnedStoryIds.has(raw.id),
    };
  }

  const visibleStories = (storyRows ?? []).filter((s) => projectIdSet.has(s.project_id));
  const activeItems: MyWorkActiveItem[] = visibleStories
    .filter((s) => categoryByStateId.get(s.state_id as string) !== "done")
    .map((s) => ({
      id: s.id,
      projectId: s.project_id,
      iterationId: s.iteration_id,
      position: s.position,
      category: categoryByStateId.get(s.state_id as string) ?? null,
      row: toRowData(s),
    }));
  const doneItems: MyWorkDoneItem[] = visibleStories
    .filter((s) => categoryByStateId.get(s.state_id as string) === "done" && s.completed_at)
    .map((s) => ({ completedAt: s.completed_at as string, row: toRowData(s) }));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">My Work</h1>
      </div>

      {soloPersonalProject && (
        <div className="mb-6">
          <MyWorkQuickAdd
            projectId={soloPersonalProject.id}
            currentUserId={user!.id}
            pointScale={pointScaleValues(soloProject?.point_scale ?? "fibonacci", soloProject?.custom_points)}
            epics={(soloEpics ?? []).map((e) => ({ id: e.id, name: e.name }))}
            labels={(soloLabels ?? []).map((l) => ({ id: l.id, name: l.name }))}
            members={(soloMembers ?? []).map((m) => {
              const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              return {
                id: m.user_id,
                name: profile?.display_name ?? m.user_id.slice(0, 8),
                isAgent: profile?.is_agent ?? false,
              };
            })}
          />
        </div>
      )}

      <MyWorkSections
        activeItems={activeItems}
        doneItems={doneItems}
        projects={projects}
        currentIterationByProject={[...currentIterationEntries]}
        pinnedStoryIds={[...pinnedStoryIds]}
      />
    </main>
  );
}
