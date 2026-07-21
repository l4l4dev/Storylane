import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { rolloverIterationSafely } from "@/lib/supabase/rollover";
import { buildMyWorkSections, type MyWorkStory } from "@/lib/utils/my-work";
import { pointScaleValues, storyStateBadge } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import { MyWorkRow, type MyWorkRowData } from "@/components/features/my-work/my-work-row";
import { MyWorkQuickAdd } from "@/components/features/my-work/my-work-quick-add";
import { Button } from "@/components/ui/button";

// Cross-project personal view (spec/screens.md "My Work", doc-8 §9): the
// signed-in user's assigned, non-Icebox, non-done stories, split into Today
// (a personal project's current iteration + anything pinned) and Assigned
// (everything else, grouped by project).
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
  const projects = (projectRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    // TASK-103: the real flag, not iteration_length === 1 (a 1-day team
    // project is legitimate and is NOT the user's personal project). Scoped
    // to the viewer's OWN personal project (created_by) — an invited member of
    // someone else's personal project must not have it treated as their own
    // Today project / rolled over (rls-security-reviewer, TASK-103).
    isPersonal: p.is_personal && p.created_by === user?.id,
  }));
  const projectIds = new Set(projects.map((p) => p.id));
  const personalProjects = projects.filter((p) => p.isPersonal);

  // Roll over personal projects before reading their current iteration —
  // only cadence that matters for "today" membership (spec/velocity.md
  // "Automatic scheduling & rollover"); other projects' Today membership
  // depends only on pins, not on their current iteration being fresh.
  await Promise.all(personalProjects.map((p) => rolloverIterationSafely(p.id)));

  async function fetchCurrentIteration(projectId: string): Promise<readonly [string, string | null]> {
    const { data } = await supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .order("number", { ascending: false })
      .limit(1);
    return [projectId, data?.[0]?.id ?? null] as const;
  }

  const [{ data: statesRows }, { data: storyRows }, { data: pinRows }, currentIterationEntries] = await Promise.all([
    supabase
      .from("project_states")
      .select("id, project_id, name, action_label, category, position, created_at")
      .in("project_id", [...projectIds]),
    user
      ? supabase
          .from("stories")
          .select("id, project_id, number, title, story_type, state_id, points, iteration_id, position")
          .eq("assignee_id", user.id)
          .not("state_id", "is", null)
      : Promise.resolve({ data: null }),
    user
      ? supabase.from("story_pins").select("story_id").eq("user_id", user.id)
      : Promise.resolve({ data: null }),
    Promise.all(personalProjects.map((p) => fetchCurrentIteration(p.id))),
  ]);

  const statesByProject = new Map<string, ProjectState[]>();
  for (const state of (statesRows ?? []) as ProjectState[]) {
    const bucket = statesByProject.get(state.project_id);
    if (bucket) bucket.push(state);
    else statesByProject.set(state.project_id, [state]);
  }
  const categoryByStateId = new Map((statesRows ?? []).map((s) => [s.id, s.category]));
  const currentIterationByProject = new Map(currentIterationEntries);
  const pinnedStoryIds = new Set((pinRows ?? []).map((p) => p.story_id));

  // projectIds already excludes archived projects; state_id IS NOT NULL
  // (Icebox) is filtered in the query above.
  const activeStories: MyWorkStory[] = (storyRows ?? [])
    .filter((s) => projectIds.has(s.project_id) && categoryByStateId.get(s.state_id as string) !== "done")
    .map((s) => ({ id: s.id, projectId: s.project_id, iterationId: s.iteration_id, position: s.position }));

  const { today, assigned } = buildMyWorkSections(activeStories, projects, currentIterationByProject, pinnedStoryIds);

  const storyById = new Map((storyRows ?? []).map((s) => [s.id, s]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  function toRowData(story: MyWorkStory): MyWorkRowData {
    const raw = storyById.get(story.id)!;
    const project = projectById.get(story.projectId)!;
    const states = statesByProject.get(story.projectId) ?? [];
    return {
      id: raw.id,
      number: raw.number,
      title: raw.title,
      storyType: raw.story_type,
      points: raw.points,
      projectId: project.id,
      projectName: project.name,
      isPersonal: project.isPersonal,
      stateBadge: storyStateBadge(raw.state_id, states),
      pinned: pinnedStoryIds.has(raw.id),
    };
  }

  const isEmpty = today.length === 0 && assigned.length === 0;
  // No global quick-add shortcut (doc-8 §10) — instead, the common case of
  // exactly one personal project gets its own draft card right here (TASK-82
  // Pivotal-parity form, reused). Zero or multiple personal projects:
  // ambiguous which one, so none renders.
  const soloPersonalProject = personalProjects.length === 1 ? personalProjects[0] : null;
  const [{ data: soloEpics }, { data: soloLabels }, { data: soloMembers }, { data: soloProject }] = soloPersonalProject
    ? await Promise.all([
        supabase.from("epics").select("id, name").eq("project_id", soloPersonalProject.id).order("position"),
        supabase.from("labels").select("id, name").eq("project_id", soloPersonalProject.id).order("name"),
        supabase
          .from("project_members")
          .select("user_id, profiles(display_name, is_agent)")
          .eq("project_id", soloPersonalProject.id),
        supabase.from("projects").select("point_scale, custom_points").eq("id", soloPersonalProject.id).single(),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">My Work</h1>
        {/* TASK-104 (doc-11 D2): the projects list stays the dedicated
            index — this reuses its inline create panel (?new=1) rather
            than duplicating a creation form here. Kept on its own fixed
            spot on the h1 row (not sharing a row with the quick-add below)
            so expanding the quick-add's draft card never pushes or
            squashes it (spec/ux-principles.md principle 3). */}
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard?new=1">New project</Link>
        </Button>
      </div>

      {soloPersonalProject && (
        <div className="mb-6">
          <MyWorkQuickAdd
            projectId={soloPersonalProject.id}
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

      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          {soloPersonalProject
            ? "Add a personal task above to plan your day. Stories assigned to you across your team projects show up here too."
            : "Nothing assigned to you yet. Stories assigned to you across your projects will show up here."}
        </p>
      )}

      {today.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Today</h2>
          <div className="flex flex-col gap-1.5">
            {today.map((story) => (
              <MyWorkRow key={story.id} story={toRowData(story)} />
            ))}
          </div>
        </section>
      )}

      {assigned.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Assigned</h2>
          {assigned.map((group) => (
            <div key={group.projectId} className="mb-6">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.projectName}</h3>
              <div className="flex flex-col gap-1.5">
                {group.stories.map((story) => (
                  <MyWorkRow key={story.id} story={toRowData(story)} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
