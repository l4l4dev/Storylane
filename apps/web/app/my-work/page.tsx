import { addDays, type StateCategory } from "@storylane/core";
import { createClient } from "@/lib/supabase/server";
import { utcTodayKey } from "@/lib/utils/format";
import {
  brokenMappingProjectIds,
  classifyMyWork,
  type DoneEntry,
  type MyWorkMapping,
  type MyWorkProject,
  type MyWorkStory,
} from "@/lib/utils/my-work";
import { pointScaleValues, storyStateBadge } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import { MyWorkMappingBrokenBanner } from "@/components/features/my-work/my-work-mapping-broken-banner";
import { MyWorkSections } from "@/components/features/my-work/my-work-sections";
import type { MyWorkRowData } from "@/components/features/my-work/my-work-row";
import { MyWorkQuickAdd } from "@/components/features/my-work/my-work-quick-add";

// How far back the Done log reaches (doc-14) — recent completions only; full
// history is each project's Iterations page.
const DONE_WINDOW_DAYS = 7;

// Cross-project personal view (doc-14 "My Work Kanban rework"): the signed-in
// user's assigned, non-Icebox stories split into Todo/Today/Doing plus a
// completion-history Done log. This server component fetches, shapes, and
// classifies the rows; MyWorkSections (client) renders the columns. My Work
// keeps its OWN status (my_work_story_state) independent of the real board,
// optionally synced when a project configures a Doing mapping.
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

  // An explicit UTC timestamp (not a bare date) so the comparison below is
  // unambiguous regardless of the DB session's timezone setting — a bare
  // "YYYY-MM-DD" literal would be cast to timestamptz using that session
  // timezone, not necessarily UTC. Built from imported helpers, not an
  // inline Date.now(), which the RSC purity rule forbids during render.
  const doneSince = `${addDays(utcTodayKey(), -DONE_WINDOW_DAYS)}T00:00:00.000Z`;

  const [
    { data: statesRows },
    { data: storyRows },
    { data: myStateRows },
    { data: mappingRows },
    { data: myRoleRows },
    { data: completionRows },
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
          .select("id, project_id, number, title, story_type, state_id, points, position")
          .eq("assignee_id", user.id)
          .not("state_id", "is", null)
          // Active axis only: real-done stories live in the Done log via their
          // completion rows, never as an active card, so they're excluded here
          // (completed_at is set the moment a story enters a done category).
          .is("completed_at", null)
      : Promise.resolve({ data: null }),
    // The viewer's own My Work marks — is_today / local_status per story.
    user
      ? supabase.from("my_work_story_state").select("story_id, is_today, local_status, updated_at").eq("user_id", user.id)
      : Promise.resolve({ data: null }),
    supabase
      .from("project_my_work_mapping")
      .select("project_id, doing_state_id, done_state_id, configured_by")
      .in("project_id", projectIds),
    // Only an owner can reconfigure a project's My Work mapping (Settings'
    // "My Work sync" section renders owner-only) — the broken-mapping banner
    // must stay scoped to owners too (spec/screens.md "owner-visible"), or a
    // plain member would see a "reconfigure in Settings" link to a section
    // they can't even see.
    user
      ? supabase.from("project_members").select("project_id, role").eq("user_id", user.id).in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    // The Done log (doc-14): the viewer's completion history, live-joined to
    // each story's CURRENT data and project name so a completion survives being
    // reassigned away or even leaving the project (stories' SELECT RLS OR-clause).
    user
      ? supabase
          .from("story_completions")
          .select(
            "completed_at, stories(id, project_id, number, title, story_type, points, state_id, projects(name))",
          )
          .eq("user_id", user.id)
          .gte("completed_at", doneSince)
          .order("completed_at", { ascending: false })
      : Promise.resolve({ data: null }),
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

  const statesByProject = new Map<string, ProjectState[]>();
  for (const state of (statesRows ?? []) as ProjectState[]) {
    const bucket = statesByProject.get(state.project_id);
    if (bucket) bucket.push(state);
    else statesByProject.set(state.project_id, [state]);
  }
  const categoryByStateId = new Map((statesRows ?? []).map((s) => [s.id, s.category as StateCategory]));
  const projectIdSet = new Set(projectIds);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // A project is "mapped" for Doing/Done classification only when its Doing
  // mapping still points to a live in_progress-category state (doc-14: a
  // category change is treated read-side as unmapped, no trigger). done_state_id
  // isn't needed here — Done is completion-history driven, not category-derived.
  const mappedProjectIds = new Set(
    (mappingRows ?? [])
      .filter((m) => m.doing_state_id && categoryByStateId.get(m.doing_state_id) === "in_progress")
      .map((m) => m.project_id),
  );

  // TASK-133: a project the owner DID configure, whose mapped state(s) have
  // since drifted category — surfaced as a banner, not silently treated as
  // unmapped (which the classification above already does read-side).
  const mappings: MyWorkMapping[] = (mappingRows ?? []).map((m) => ({
    projectId: m.project_id,
    doingStateId: m.doing_state_id,
    doneStateId: m.done_state_id,
    configured: m.configured_by !== null,
  }));
  const ownerProjectIds = new Set(
    (myRoleRows ?? []).filter((r) => r.role === "owner").map((r) => r.project_id),
  );
  const brokenProjects = [...brokenMappingProjectIds(mappings, categoryByStateId, ownerProjectIds)]
    .map((id) => projectById.get(id))
    .filter((p): p is MyWorkProject => p !== undefined);

  const myStateByStoryId = new Map(
    (myStateRows ?? []).map((r) => [r.story_id, r] as const),
  );

  function toRowData(
    raw: { id: string; number: number; title: string; story_type: string; points: number | null; project_id: string; state_id: string | null },
    projectName: string,
  ): MyWorkRowData {
    return {
      id: raw.id,
      number: raw.number,
      title: raw.title,
      storyType: raw.story_type,
      points: raw.points,
      projectId: raw.project_id,
      projectName,
      stateBadge: storyStateBadge(raw.state_id, statesByProject.get(raw.project_id) ?? []),
    };
  }

  const assigned: MyWorkStory<MyWorkRowData>[] = (storyRows ?? [])
    .filter((s) => projectIdSet.has(s.project_id))
    .map((s) => {
      const mark = myStateByStoryId.get(s.id);
      const project = projectById.get(s.project_id)!;
      return {
        id: s.id,
        projectId: s.project_id,
        position: s.position,
        category: categoryByStateId.get(s.state_id as string) ?? "unstarted",
        isToday: mark?.is_today ?? false,
        localStatus: (mark?.local_status as MyWorkStory["localStatus"]) ?? null,
        mapped: mappedProjectIds.has(s.project_id),
        localUpdatedAt: mark?.updated_at ?? null,
        row: toRowData(s, project.name),
      };
    });

  const completions: DoneEntry<MyWorkRowData>[] = (completionRows ?? []).flatMap((c) => {
    // The embedded story/project can type as an object or a single-element
    // array depending on the FK cardinality Supabase infers; normalize both.
    const story = Array.isArray(c.stories) ? c.stories[0] : c.stories;
    if (!story) return [];
    const embeddedProject = Array.isArray(story.projects) ? story.projects[0] : story.projects;
    const projectName = projectById.get(story.project_id)?.name ?? embeddedProject?.name ?? "Unknown project";
    return [{ completedAt: c.completed_at, row: toRowData(story, projectName) }];
  });

  const columns = classifyMyWork(assigned, completions, projects);

  return (
    // Unconstrained width (matches the project board's own <main className="p-6">)
    // now that the four columns render side by side (TASK-132) — the header and
    // quick-add card keep their own reading width via the inner max-w-3xl wrapper.
    <main className="p-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">My Work</h1>
      </div>

      <MyWorkMappingBrokenBanner projects={brokenProjects} />

      {soloPersonalProject && (
        <div className="mx-auto mb-6 max-w-3xl">
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

      <MyWorkSections columns={columns} />
    </main>
  );
}
