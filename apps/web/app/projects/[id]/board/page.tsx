import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  columnForStory,
} from "@/lib/utils/kanban";
import type { BacklogRowItem } from "@/lib/utils/iterations";
import { filterStories, pointScaleValues } from "@/lib/utils/stories";
import { calculateVelocity } from "@/lib/utils/velocity";
import { getStoryDetail } from "@/app/stories/[id]/actions";
import { BoardFilters } from "@/components/features/board/board-filters";
import { FreeBoard, type CustomStatus, type Swimlane } from "@/components/features/board/free-board";
import { laneContainerKey } from "@/lib/utils/board";
import { KanbanBoard, type BoardStory, type IterationMeta } from "@/components/features/board/kanban-board";
import { StoryPeekHost } from "@/components/features/board/story-peek-host";
import { InviteFailedBanner, parseInviteFailedCount } from "@/components/features/projects/invite-failed-banner";
import { parsePromotedEpic, PromotedEpicBanner, type PromotedEpic } from "@/components/features/board/promoted-epic-banner";
import { ensureCurrentIteration, generateRecurringStories } from "./actions";

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
    .select("id, name, velocity_window, workflow_mode, iteration_length, point_scale, custom_points")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  // Free-mode projects get the Trello-style board — no iterations, so the
  // lazy rollover below must never run for them.
  if (project.workflow_mode === "free") {
    return (
      <FreeBoardPage
        projectId={project.id}
        type={type}
        assignee={assignee}
        label={label}
        epic={epic}
        peekStoryId={peekStoryId}
        inviteFailedCount={inviteFailedCount}
        promotedEpic={promotedEpic}
        user={user}
      />
    );
  }

  // Lazily creates/rolls over the current iteration before reading it (see
  // spec/velocity.md "Automatic scheduling & rollover") — must run before the
  // iterations query below.
  await ensureCurrentIteration(project.id);

  const [{ data: iterations }, { data: stories }, { data: labels }, { data: epics }, { data: members }, { data: dividers }, { data: pendingGoals }] =
    await Promise.all([
      supabase
        .from("iterations")
        .select("id, number, goal, start_date, end_date, velocity, state, skipped")
        .eq("project_id", id)
        .order("number", { ascending: true }),
      supabase
        .from("stories")
        .select(
          "id, number, title, description, story_type, state, points, position, iteration_id, epic_id, assignee_id, focus, completed_at, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name)",
        )
        .eq("project_id", id)
        .order("position", { ascending: true }),
      supabase.from("labels").select("id, name, color").eq("project_id", id).order("name"),
      supabase.from("epics").select("id, name, color").eq("project_id", id).order("position", { ascending: true }),
      supabase
        .from("project_members")
        .select("user_id, role, profiles(display_name)")
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
    ]);

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
        state: story.state,
        points: story.points,
        position: story.position,
        iteration_id: story.iteration_id,
        assignee_id: story.assignee_id,
        focus: story.focus,
        completed_at: story.completed_at,
        assigneeName: assigneeProfile?.display_name ?? null,
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
    unstarted: [],
    started: [],
    finished: [],
    delivered: [],
    accepted: [],
    rejected: [],
  };
  for (const card of cards) {
    const column = columnForStory(card, currentIteration?.id ?? null);
    initialContainers[column].push(card);
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

  // Skipped iterations are done but excluded from the velocity window so
  // their (normally 0) velocity doesn't drag the average (spec/velocity.md).
  const completed = allIterations
    .filter((iteration) => iteration.state === "done" && !iteration.skipped)
    .sort((a, b) => b.number - a.number);
  const currentVelocity = calculateVelocity(completed, project.velocity_window);
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
    return { id: m.user_id, name: profile?.display_name ?? m.user_id.slice(0, 8) };
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Board</h1>
        <span className="text-sm text-muted-foreground">Current velocity: {currentVelocity} pts</span>
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
        initialContainers={initialContainers}
        initialBacklogItems={initialBacklogItems}
        velocity={currentVelocity}
        nextVirtualIterationNumber={nextVirtualIterationNumber}
        iterationLength={project.iteration_length}
        iterationGoals={iterationGoals}
        canFinishIteration={canFinishIteration}
        filter={filter}
        pointScale={pointScaleValues(project.point_scale, project.custom_points)}
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

// Free-mode board page: columns are the project's custom statuses;
// stories are grouped by `custom_status_id`. No iterations, velocity,
// backlog, or Icebox. Filters and the side peek work the same.
async function FreeBoardPage({
  projectId,
  type,
  assignee,
  label,
  epic,
  peekStoryId,
  inviteFailedCount,
  promotedEpic,
  user,
}: {
  projectId: string;
  type?: string;
  assignee?: string;
  label?: string;
  epic?: string;
  peekStoryId?: string;
  inviteFailedCount: number | null;
  promotedEpic: PromotedEpic | null;
  user: User | null;
}) {
  const supabase = await createClient();

  // Lazily generate any due recurring-story instances before reading
  // stories below — must run first, same ordering constraint as
  // ensureCurrentIteration above for tracker mode.
  await generateRecurringStories(projectId);

  const [{ data: statuses }, { data: lanes }, { data: stories }, { data: labels }, { data: epics }, { data: members }] =
    await Promise.all([
      supabase
        .from("custom_statuses")
        .select("id, name, color, position, is_done, wip_limit")
        .eq("project_id", projectId)
        .order("position", { ascending: true }),
      supabase
        .from("swimlanes")
        .select("id, name, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true }),
      supabase
        .from("stories")
        .select(
          "id, number, title, description, story_type, state, points, position, custom_status_id, swimlane_id, epic_id, completed_at, assignee_id, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name)",
        )
        .eq("project_id", projectId)
        // Secondary key: once lanes split a column into multiple cells,
        // removing all lanes and returning to a single band can leave two
        // stories tied on `position` — a deterministic tiebreaker keeps
        // their order stable instead of flapping between reloads.
        .order("position", { ascending: true })
        .order("id", { ascending: true }),
      supabase.from("labels").select("id, name, color").eq("project_id", projectId).order("name"),
      supabase.from("epics").select("id, name, color").eq("project_id", projectId).order("position", { ascending: true }),
      supabase.from("project_members").select("user_id, role, profiles(display_name)").eq("project_id", projectId),
    ]);

  const statusList: CustomStatus[] = statuses ?? [];
  const laneList: Swimlane[] = lanes ?? [];
  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const epicById = new Map((epics ?? []).map((e) => [e.id, e]));

  const cards = (stories ?? []).map((story) => {
    const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
    const labelIds = story.story_labels.map((sl) => sl.label_id);
    const epic = story.epic_id ? epicById.get(story.epic_id) : undefined;
    return {
      id: story.id,
      number: story.number,
      title: story.title,
      description: story.description,
      story_type: story.story_type,
      state: story.state,
      points: story.points,
      custom_status_id: story.custom_status_id,
      swimlane_id: story.swimlane_id,
      completed_at: story.completed_at,
      assignee_id: story.assignee_id,
      assigneeName: assigneeProfile?.display_name ?? null,
      labels: labelIds
        .map((labelId) => labelById.get(labelId))
        .filter((l): l is NonNullable<typeof l> => l != null)
        .map((l) => ({ id: l.id, name: l.name, color: l.color })),
      labelIds,
      epic_id: story.epic_id,
      epic: epic ? { id: epic.id, name: epic.name, color: epic.color } : null,
    };
  });

  const visible = filterStories(cards, { type, assigneeId: assignee, labelId: label, epicId: epic });
  const hasLanes = laneList.length > 0;
  const statusIds = new Set(statusList.map((s) => s.id));
  const laneIds = new Set(laneList.map((l) => l.id));

  const initialContainers: Record<string, typeof cards> = {};
  for (const status of statusList) {
    if (hasLanes) {
      initialContainers[laneContainerKey(status.id, null)] = [];
      for (const lane of laneList) {
        initialContainers[laneContainerKey(status.id, lane.id)] = [];
      }
    } else {
      initialContainers[status.id] = [];
    }
  }
  const firstStatusId = statusList[0]?.id;
  for (const card of visible) {
    // A story with no (or an unknown) status lands in the first column so
    // it can't silently disappear from the board.
    const columnId = card.custom_status_id && statusIds.has(card.custom_status_id) ? card.custom_status_id : firstStatusId;
    if (!columnId) {
      continue;
    }
    const laneId = card.swimlane_id && laneIds.has(card.swimlane_id) ? card.swimlane_id : null;
    const containerKey = hasLanes ? laneContainerKey(columnId, laneId) : columnId;
    initialContainers[containerKey].push(card);
  }

  const assigneeOptions = (members ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.user_id, name: profile?.display_name ?? m.user_id.slice(0, 8) };
  });

  // Same gating as settings/page.tsx's StatusManager (project_role RLS on
  // custom_statuses) — member+ can add/rename/recolor, owner-only can delete.
  const myRole = (members ?? []).find((m) => m.user_id === user?.id)?.role;
  const canEdit = myRole === "owner" || myRole === "member";
  const canDelete = myRole === "owner";

  const peekDetail = peekStoryId ? await getStoryDetail(peekStoryId) : null;

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Board</h1>
      </div>

      {inviteFailedCount !== null && (
        <InviteFailedBanner count={inviteFailedCount} settingsHref={`/projects/${projectId}/settings`} />
      )}
      {promotedEpic && (
        <PromotedEpicBanner projectId={projectId} epicId={promotedEpic.id} epicName={promotedEpic.name} />
      )}

      <FreeBoard
        projectId={projectId}
        statuses={statusList}
        lanes={laneList}
        initialContainers={initialContainers}
        canEdit={canEdit}
        canDelete={canDelete}
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
