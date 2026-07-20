import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  columnForStory,
} from "@/lib/utils/kanban";
import { projectedIterationDates, type BacklogRowItem } from "@/lib/utils/iterations";
import { pointScaleValues } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import {
  forecastPoints,
  projectCapacity,
  velocityRate,
  type CalendarException,
} from "@storylane/core";
import { getStoryDetail } from "@/app/stories/[id]/actions";
import { BoardFilters } from "@/components/features/board/board-filters";
import { KanbanBoard, type BoardStory, type IterationMeta } from "@/components/features/board/kanban-board";
import { StoryPeekHost } from "@/components/features/board/story-peek-host";
import { InviteFailedBanner, parseInviteFailedCount } from "@/components/features/projects/invite-failed-banner";
import { parsePromotedEpic, PromotedEpicBanner } from "@/components/features/board/promoted-epic-banner";
import { ensureCurrentIteration } from "./actions";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    type?: string;
    assignee?: string;
    label?: string;
    epic?: string;
    story?: string;
    invite_failed?: string;
    promoted_epic?: string;
    promoted_epic_name?: string;
  }>;
}) {
  const { id } = await params;
  const {
    type,
    assignee,
    label,
    epic,
    story: peekStoryId,
    invite_failed,
    promoted_epic,
    promoted_epic_name,
  } = await searchParams;
  // TASK-32: project creation now redirects straight to the new project's
  // board instead of /dashboard, so this is where a partial invite failure
  // from that flow must surface instead — never silently.
  const inviteFailedCount = parseInviteFailedCount(invite_failed);
  // TASK-41: "Promote to Epic" (story-peek-menu.tsx) redirects here instead
  // of jumping to /epics, so this is where its confirmation banner surfaces.
  const promotedEpic = parsePromotedEpic(promoted_epic, promoted_epic_name);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, velocity_window, iteration_length, point_scale, custom_points, working_weekdays")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }


  // Lazily creates/rolls over the current iteration before reading it (see
  // spec/velocity.md "Automatic scheduling & rollover") — must run before the
  // iterations query below.
  await ensureCurrentIteration(project.id);

  const [{ data: iterations }, { data: stories }, { data: labels }, { data: epics }, { data: members }, { data: dividers }, { data: pendingGoals }, { data: statesData }] =
    await Promise.all([
      supabase
        .from("iterations")
        .select("id, number, goal, start_date, end_date, velocity, capacity, state, skipped")
        .eq("project_id", id)
        .order("number", { ascending: true }),
      supabase
        .from("stories")
        .select(
          "id, number, title, description, story_type, state_id, points, position, iteration_id, epic_id, assignee_id, completed_at, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name, is_agent)",
        )
        .eq("project_id", id)
        .order("position", { ascending: true }),
      supabase.from("labels").select("id, name, color").eq("project_id", id).order("name"),
      supabase.from("epics").select("id, name, color").eq("project_id", id).order("position", { ascending: true }),
      supabase
        .from("project_members")
        .select("user_id, role, profiles(display_name, is_agent)")
        .eq("project_id", id),
      // List view only (see components/features/board/board-list-view.tsx) —
      // freeform planning dividers for the Backlog section.
      supabase.from("backlog_dividers").select("id, label, kind, position").eq("project_id", id),
      // Draft goals for virtual (not-yet-real) future iterations, edited
      // inline on the Backlog's group headers. Small table (at
      // most one row per virtual iteration with a goal set) — cheaper to
      // fetch everything and filter to `number > currentIteration.number`
      // below than to await `currentIteration` first for a second query.
      supabase.from("iteration_goals").select("number, goal").eq("project_id", id),
      // The project's states (TASK-91) — the physical Kanban column set,
      // threaded down through KanbanBoard to every view.
      supabase
        .from("project_states")
        .select("id, project_id, name, action_label, category, position, created_at")
        .eq("project_id", id)
        .order("position", { ascending: true }),
    ]);

  const states: ProjectState[] = (statesData ?? []) as ProjectState[];
  const stateById = new Map(states.map((s) => [s.id, s]));

  const storyPositionById = new Map((stories ?? []).map((s) => [s.id, s.position]));

  const allIterations: IterationMeta[] = iterations ?? [];
  // The current iteration is whichever non-done row
  // ensureCurrentIteration's finalize_iteration RPC just left in place — not
  // "starts on or before today" (isCurrentIteration). A manually-finished
  // iteration's successor starts *tomorrow*, so requiring date coverage left
  // the board showing no current iteration at all for the rest of finish day.
  const currentIteration =
    allIterations
      .filter((iteration) => iteration.state !== "done")
      .sort((a, b) => b.number - a.number)[0] ?? null;
  const doneIterationIds = new Set(
    allIterations.filter((iteration) => iteration.state === "done").map((iteration) => iteration.id),
  );
  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const epicById = new Map((epics ?? []).map((e) => [e.id, e]));

  const cards = (stories ?? [])
    // Stories of finalized iterations belong to the history view
    // (/projects/[id]/iterations), not the board.
    .filter((story) => !(story.iteration_id && doneIterationIds.has(story.iteration_id)))
    .map((story) => {
      const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
      const labelIds = story.story_labels.map((sl) => sl.label_id);
      const epic = story.epic_id ? epicById.get(story.epic_id) : undefined;
      const card: BoardStory = {
        id: story.id,
        number: story.number,
        title: story.title,
        description: story.description,
        story_type: story.story_type,
        state_id: story.state_id,
        isDone: story.state_id !== null && stateById.get(story.state_id)?.category === "done",
        points: story.points,
        position: story.position,
        iteration_id: story.iteration_id,
        assignee_id: story.assignee_id,
        completed_at: story.completed_at,
        assigneeName: assigneeProfile?.display_name ?? null,
        assigneeIsAgent: assigneeProfile?.is_agent ?? false,
        labels: labelIds
          .map((labelId) => labelById.get(labelId))
          .filter((l): l is NonNullable<typeof l> => l != null)
          .map((l) => ({ id: l.id, name: l.name, color: l.color })),
        labelIds,
        epic_id: story.epic_id,
        epic: epic ? { id: epic.id, name: epic.name, color: epic.color } : null,
      };
      return card;
    });

  // Containers are built from every card, unfiltered — filters only hide
  // rows visually (applied client-side — see KanbanBoard/BoardListView).
  // Bucketing a pre-filtered set instead would make a filtered drag persist
  // a dense 0..n-1 position across only the visible subset, corrupting
  // hidden stories' positions, and would make the virtual-iteration
  // groups/point sums/committed-points shift with whatever filter happened
  // to be active.
  const filter = { type, assigneeId: assignee, labelId: label, epicId: epic };
  const initialContainers: Record<string, BoardStory[]> = {
    [BACKLOG_COLUMN_ID]: [],
    [ICEBOX_COLUMN_ID]: [],
  };
  for (const state of states) {
    initialContainers[state.id] = [];
  }
  for (const card of cards) {
    const column = columnForStory(card, currentIteration?.id ?? null);
    (initialContainers[column] ??= []).push(card);
  }

  // Merges backlog stories and freeform planning dividers by their shared
  // `position` sequence (see spec/data-model.md "backlog_dividers") into one
  // render-ready order for the List view — only the server has both tables'
  // raw position values needed to interleave them correctly.
  const initialBacklogItems: BacklogRowItem<BoardStory>[] = [
    ...initialContainers[BACKLOG_COLUMN_ID].map((card) => {
      const item: BacklogRowItem<BoardStory> = { kind: "story", story: card };
      return { position: storyPositionById.get(card.id) ?? 0, item };
    }),
    ...(dividers ?? []).map((divider) => {
      const kind: "note" | "iteration_break" = divider.kind === "iteration_break" ? "iteration_break" : "note";
      const item: BacklogRowItem<BoardStory> = {
        kind: "divider",
        divider: { id: divider.id, label: divider.label, kind },
      };
      return { position: divider.position, item };
    }),
  ]
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.item);

  const completed = allIterations
    .filter((iteration) => iteration.state === "done")
    .sort((a, b) => b.number - a.number);
  // Points per person-day (spec/velocity.md). velocityRate applies the
  // skipped / capacity-0 window filters itself.
  const rate = velocityRate(completed, project.velocity_window);

  // Planned capacity for the current iteration and each virtual sprint after
  // it, so every backlog group gets its own `rate x capacity` budget rather
  // than one flat number — a sprint straddling a holiday week holds less.
  // Capped because the backlog can outrun any sensible planning horizon;
  // buildBacklogRows repeats the last budget past the end of the array.
  const MAX_PROJECTED_SPRINTS = 26;
  const projectedSprints = currentIteration
    ? Array.from({ length: Math.min(initialBacklogItems.length, MAX_PROJECTED_SPRINTS) }, (_, i) =>
        projectedIterationDates(currentIteration.end_date, project.iteration_length, i + 1),
      )
    : [];
  const calendarStart = currentIteration?.start_date;
  const calendarEnd = projectedSprints[projectedSprints.length - 1]?.end_date ?? currentIteration?.end_date;
  const capacityMembers = (members ?? []).map((m) => ({ userId: m.user_id, role: m.role }));

  let calendarExceptions: CalendarException[] = [];
  const timeOffByUser = new Map<string, string[]>();
  // A failed calendar read must not silently become "no holidays, nobody
  // away" — that overstates capacity and over-commits the team. Degrade to
  // the no-history fallback (minimum 1 point per group) instead, which
  // under-plans rather than over-plans.
  let calendarUnavailable = false;
  if (calendarStart && calendarEnd && capacityMembers.length > 0) {
    const [exceptionResult, timeOffResult] = await Promise.all([
      supabase
        .from("project_calendar_exceptions")
        .select("date, kind")
        .eq("project_id", id)
        .gte("date", calendarStart)
        .lte("date", calendarEnd),
      supabase
        .from("user_time_off")
        .select("user_id, date")
        .in(
          "user_id",
          capacityMembers.map((m) => m.userId),
        )
        .gte("date", calendarStart)
        .lte("date", calendarEnd),
    ]);
    calendarUnavailable = exceptionResult.error !== null || timeOffResult.error !== null;
    calendarExceptions = (exceptionResult.data ?? []) as CalendarException[];
    for (const row of timeOffResult.data ?? []) {
      const dates = timeOffByUser.get(row.user_id);
      if (dates) {
        dates.push(row.date);
      } else {
        timeOffByUser.set(row.user_id, [row.date]);
      }
    }
  }
  const memberCalendars = capacityMembers.map((m) => ({
    role: m.role,
    timeOff: timeOffByUser.get(m.userId) ?? [],
  }));
  const budgetFor = (range: { start_date: string; end_date: string }) =>
    calendarUnavailable
      ? 1
      : forecastPoints(
          rate,
          projectCapacity({
            workingWeekdays: project.working_weekdays,
            exceptions: calendarExceptions,
            members: memberCalendars,
            start: range.start_date,
            end: range.end_date,
          }),
        );
  const currentBudget = currentIteration ? budgetFor(currentIteration) : 1;
  const backlogBudgets = projectedSprints.map(budgetFor);

  const nextVirtualIterationNumber =
    allIterations.reduce((max, iteration) => Math.max(max, iteration.number), 0) + 1;

  // Ignore any row at or below the current iteration's number (the UI never
  // shows one — see the iteration_goals_check_number DB trigger, which stops
  // new/updated rows from landing there but doesn't retroactively clean up
  // one a rollover already adopted and could not delete under plain RLS).
  const iterationGoals = Object.fromEntries(
    (pendingGoals ?? [])
      .filter((row) => row.number > (currentIteration?.number ?? 0))
      .map((row) => [row.number, row.goal]),
  );

  const assigneeOptions = (members ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const name = profile?.display_name ?? m.user_id.slice(0, 8);
    return { id: m.user_id, name: profile?.is_agent ? `${name} (agent)` : name };
  });
  // Unlike assigneeOptions above (a flat filter-dropdown label), the draft
  // story card's Assignee field renders the "(agent)" tag itself — same
  // shape getStoryDetail's own `members` uses (StoryFields is shared).
  const memberOptions = (members ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return {
      id: m.user_id,
      name: profile?.display_name ?? m.user_id.slice(0, 8),
      isAgent: profile?.is_agent ?? false,
    };
  });

  // "Finish iteration" is owner/member only (spec/velocity.md "Manual
  // finish") — the RPC enforces this too, this is just so viewers don't see
  // a button they'd be rejected for clicking.
  const myRole = (members ?? []).find((m) => m.user_id === user?.id)?.role;
  const canFinishIteration = myRole === "owner" || myRole === "member";

  // Side peek (spec/screens.md "Board layout"): ?story=<id> opens the story
  // detail over the board's right edge. Fetched server-side so the peek
  // renders in the same pass as the board.
  const peekDetail = peekStoryId ? await getStoryDetail(peekStoryId) : null;

  return (
    <main className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">
          {project.name} <span className="text-sm font-normal text-muted-foreground">Board</span>
        </h1>
      </div>

      {inviteFailedCount !== null && (
        <InviteFailedBanner count={inviteFailedCount} settingsHref={`/projects/${project.id}/settings`} />
      )}
      {promotedEpic && (
        <PromotedEpicBanner projectId={project.id} epicId={promotedEpic.id} epicName={promotedEpic.name} />
      )}

      <KanbanBoard
        projectId={project.id}
        currentIteration={currentIteration}
        states={states}
        initialContainers={initialContainers}
        initialBacklogItems={initialBacklogItems}
        currentBudget={currentBudget}
        backlogBudgets={backlogBudgets}
        nextVirtualIterationNumber={nextVirtualIterationNumber}
        iterationLength={project.iteration_length}
        iterationGoals={iterationGoals}
        canFinishIteration={canFinishIteration}
        // Same predicate as canFinishIteration (owner/member) — matches
        // project_states' own INSERT/UPDATE RLS policy.
        canManageStates={canFinishIteration}
        filter={filter}
        pointScale={pointScaleValues(project.point_scale, project.custom_points)}
        epics={(epics ?? []).map((e) => ({ id: e.id, name: e.name }))}
        members={memberOptions}
        labels={(labels ?? []).map((l) => ({ id: l.id, name: l.name }))}
        toolbar={
          <BoardFilters
            assignees={assigneeOptions}
            labels={(labels ?? []).map((l) => ({ id: l.id, name: l.name }))}
            epics={(epics ?? []).map((e) => ({ id: e.id, name: e.name }))}
          />
        }
      />

      <StoryPeekHost peekStoryId={peekStoryId} detail={peekDetail} />
    </main>
  );
}
