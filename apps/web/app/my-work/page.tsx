import Link from "next/link";
import { cookies } from "next/headers";
import { addDays } from "@storylane/core";
import { createClient } from "@/lib/supabase/server";
import { utcTodayKey } from "@/lib/utils/format";
import {
  DEFAULT_DONE_WINDOW_DAYS,
  resolveColumnNames,
  resolveColumnOrder,
  type DoneEntry,
  type MyWorkFreeColumn,
  type MyWorkProject,
  type MyWorkStory,
} from "@/lib/utils/my-work";
import { pointScaleValues, storyStateBadge } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import { MyWorkSections } from "@/components/features/my-work/my-work-sections";
import type { MyWorkRowData } from "@/components/features/my-work/my-work-row";
import { MyWorkQuickAdd } from "@/components/features/my-work/my-work-quick-add";

// Cross-project personal view (doc-15 "My Work redesign"): the signed-in user's
// assigned active stories, split into Todo / Today / user-defined free columns
// plus a completion-history Done log. This server component fetches and shapes
// the rows; MyWorkSections (client) classifies them against the VIEWER's local
// today (Today is date-scoped — a server render has no viewer timezone) and
// renders the columns. There is no project-board mapping any more — My Work is
// a purely personal board (doc-15).
export default async function MyWorkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The viewer's local wall date, seeded server-side from a cookie the client
  // keeps fresh (my-work-sections.tsx) whenever it differs from what SSR used
  // last time. Falls back to UTC on a first-ever visit (no cookie yet) — the
  // one case a server render truly can't know the viewer's timezone (TASK-163:
  // west/east of UTC, classifying Today's cards against the wrong day for a
  // stretch of every day caused a visible misplace-then-correct flash on every
  // reload once hydration corrected it, not just a one-off first-load gap).
  const localDateCookie = (await cookies()).get("local_date")?.value;
  const serverTodayKey = localDateCookie && /^\d{4}-\d{2}-\d{2}$/.test(localDateCookie) ? localDateCookie : utcTodayKey();

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

  // Fetched ahead of the batch below since doneSince (used by the
  // completions query in that same batch) depends on the configured window.
  const { data: profileRow } = user
    ? await supabase
        .from("profiles")
        .select("my_work_column_order, my_work_column_names, my_work_done_window_days")
        .eq("id", user.id)
        .single()
    : { data: null };
  const doneWindowDays = profileRow?.my_work_done_window_days ?? DEFAULT_DONE_WINDOW_DAYS;

  // An explicit UTC timestamp (not a bare date) so the comparison below is
  // unambiguous regardless of the DB session's timezone setting.
  const doneSince = `${addDays(utcTodayKey(), -doneWindowDays)}T00:00:00.000Z`;

  const [
    { data: statesRows },
    { data: storyRows },
    { data: myStateRows },
    { data: columnRows },
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
          // completion rows, never as an active card (completed_at is set the
          // moment a story enters a done category).
          .is("completed_at", null)
      : Promise.resolve({ data: null }),
    // The viewer's own My Work marks — column_id / today_date / today_position
    // / column_position (TASK-150: free-column manual order).
    user
      ? supabase
          .from("my_work_story_state")
          .select("story_id, column_id, today_date, today_position, column_position")
          .eq("user_id", user.id)
      : Promise.resolve({ data: null }),
    // The viewer's free columns (doc-15). 'Doing' is pre-seeded.
    user
      ? supabase.from("my_work_columns").select("id, name, position").eq("user_id", user.id).order("position")
      : Promise.resolve({ data: null }),
    // The Done log (doc-14): the viewer's completion history, live-joined to
    // each story's CURRENT data so a completion survives being reassigned away
    // or even leaving the project (stories' SELECT RLS OR-clause).
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
  const projectIdSet = new Set(projectIds);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const freeColumns: MyWorkFreeColumn[] = (columnRows ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
  }));
  const columnOrder = resolveColumnOrder(profileRow?.my_work_column_order ?? [], freeColumns);
  const columnNames = resolveColumnNames(profileRow?.my_work_column_names);

  const myStateByStoryId = new Map((myStateRows ?? []).map((r) => [r.story_id, r] as const));

  function toRowData(
    raw: { id: string; number: number; title: string; story_type: string; points: number | null; project_id: string; state_id: string | null },
    project: { name: string; isPersonal: boolean },
  ): MyWorkRowData {
    return {
      id: raw.id,
      number: raw.number,
      title: raw.title,
      storyType: raw.story_type,
      points: raw.points,
      projectId: raw.project_id,
      projectName: project.name,
      isPersonal: project.isPersonal,
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
        todayDate: mark?.today_date ?? null,
        todayPosition: mark?.today_position ?? null,
        columnId: mark?.column_id ?? null,
        columnPosition: mark?.column_position ?? null,
        row: toRowData(s, project),
      };
    });

  const completions: DoneEntry<MyWorkRowData>[] = (completionRows ?? []).flatMap((c) => {
    // The embedded story/project can type as an object or a single-element
    // array depending on the FK cardinality Supabase infers; normalize both.
    const story = Array.isArray(c.stories) ? c.stories[0] : c.stories;
    if (!story) return [];
    const embeddedProject = Array.isArray(story.projects) ? story.projects[0] : story.projects;
    const knownProject = projectById.get(story.project_id);
    const projectName = knownProject?.name ?? embeddedProject?.name ?? "Unknown project";
    return [{ completedAt: c.completed_at, row: toRowData(story, { name: projectName, isPersonal: knownProject?.isPersonal ?? false }) }];
  });

  return (
    // Unconstrained width (matches the project board's own <main className="p-6">)
    // now that the columns render side by side — the header and quick-add card
    // keep their own reading width via the inner max-w-3xl wrapper.
    <main className="p-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">My Work</h1>
        {/* TASK-147 AC#6: dev-only inspection of the hidden personal
            project's raw data — /dev/my-tasks 404s in production regardless,
            this just keeps the link itself out of a production build too. */}
        {process.env.NODE_ENV !== "production" && (
          <Link href="/dev/my-tasks" className="text-xs text-muted-foreground underline">
            Debug: My Tasks
          </Link>
        )}
      </div>

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

      <MyWorkSections
        assigned={assigned}
        completions={completions}
        projects={projects}
        freeColumns={freeColumns}
        order={columnOrder}
        columnNames={columnNames}
        hasQuickAdd={soloPersonalProject !== null}
        doneWindowDays={doneWindowDays}
        serverTodayKey={serverTodayKey}
      />
    </main>
  );
}
