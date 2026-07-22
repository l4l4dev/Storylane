// Pure classification/ordering logic for the My Work screen (doc-14 "My Work
// Kanban rework"). Framework-free like the rest of lib/utils — the page
// (server) shapes DB rows into these types, calls classifyMyWork, and hands
// the four columns to the renderer.
//
// Two independent axes (doc-14 "Classification", TASK-131 AC #11 ROUND-4):
//   - Done is completion-history scoped and ADDITIVE — every story_completions
//     row for the viewer is a Done entry, plus unmapped local_status='done'
//     marks. It is evaluated independently of the active axis, so a story
//     completed earlier and now reopened+assigned shows in BOTH Done and Doing.
//   - Todo/Today/Doing are current-assignee scoped, gated only by "real state
//     category != done" — see assignedColumn.

import type { StateCategory } from "@storylane/core";

export type MyWorkColumn = "todo" | "today" | "doing" | "done";

export type MyWorkProject = {
  id: string;
  name: string;
  // The viewer's own personal project (projects.is_personal AND created_by =
  // viewer, resolved by the page — TASK-103). Sorts groups first.
  isPersonal: boolean;
};

// An assigned, non-Icebox story in the viewer's My Work base scope, plus the
// per-viewer marks needed to place it. `category` is the real state category
// (Icebox filtered upstream, so non-null). `mapped` = the project has a valid
// in_progress Doing mapping, so Doing/Todo is derived from the real state and
// local_status is ignored. `S` is the render payload the page attaches.
export type MyWorkStory<S = unknown> = {
  id: string;
  projectId: string;
  position: number;
  category: StateCategory;
  isToday: boolean;
  localStatus: "todo" | "doing" | "done" | null;
  mapped: boolean;
  // my_work_story_state.updated_at — the completion "date" for an unmapped
  // local 'done' mark, which (unlike a real completion) has no
  // story_completions row of its own.
  localUpdatedAt: string | null;
  row: S;
};

export type MyWorkGroup<S> = {
  projectId: string;
  projectName: string;
  isPersonal: boolean;
  stories: MyWorkStory<S>[];
};

// A Done entry — either a story_completions row (live-joined to the story's
// current data by the page, so a reassigned-away completion still renders) or
// an unmapped local 'done' mark. Both reduce to a completion date + render row.
export type DoneEntry<S> = { completedAt: string; row: S };

export type MyWorkColumns<S> = {
  todo: MyWorkGroup<S>[];
  today: MyWorkStory<S>[];
  doing: MyWorkStory<S>[];
  done: DoneEntry<S>[];
};

function compareGroup(a: { isPersonal: boolean; name: string }, b: { isPersonal: boolean; name: string }): number {
  if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// Which active column an assigned story lands in — or "done" for an unmapped
// local completion mark, or null when its real state is already done (then it
// lives in the Done log via its story_completions row, never as an active
// card). doc-14 "Classification" + TASK-131 AC #11/#12 (ROUND-4).
export function assignedColumn<S>(s: MyWorkStory<S>): MyWorkColumn | null {
  // Real done: represented solely by its completion-log entry, not as a card.
  if (s.category === "done") return null;
  const derived: "todo" | "doing" = s.category === "in_progress" ? "doing" : "todo";
  const effective = s.mapped ? derived : (s.localStatus ?? derived);
  // Unmapped local 'done' — a cancellable local mark (NOT a permanent
  // completion log; it has no story_completions row). Outranks the Today
  // marker, matching the exclusive Done>Today ordering for a card's own slot.
  if (effective === "done") return "done";
  if (s.isToday) return "today";
  return effective;
}

/**
 * Splits the viewer's assigned non-Icebox stories + their completion history
 * into the four My Work columns (doc-14). `assigned` must already exclude
 * real-done stories' active representation is handled here (assignedColumn
 * returns null for them). `completions` is one entry per story_completions row,
 * live-joined to the story's current data by the caller.
 */
export function classifyMyWork<S>(
  assigned: readonly MyWorkStory<S>[],
  completions: readonly DoneEntry<S>[],
  projects: readonly MyWorkProject[],
): MyWorkColumns<S> {
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const today: MyWorkStory<S>[] = [];
  const doing: MyWorkStory<S>[] = [];
  const rest: MyWorkStory<S>[] = [];
  const localDone: DoneEntry<S>[] = [];
  for (const story of assigned) {
    switch (assignedColumn(story)) {
      case "today":
        today.push(story);
        break;
      case "doing":
        doing.push(story);
        break;
      case "todo":
        rest.push(story);
        break;
      case "done":
        localDone.push({ completedAt: story.localUpdatedAt ?? "", row: story.row });
        break;
      // null: real-done, shown only via its completion entry.
    }
  }

  const sortWithinGroup = (a: MyWorkStory<S>, b: MyWorkStory<S>) => a.position - b.position;
  const sortCrossProject = (a: MyWorkStory<S>, b: MyWorkStory<S>) => {
    const pa = projectById.get(a.projectId);
    const pb = projectById.get(b.projectId);
    if (pa && pb) {
      const byGroup = compareGroup(pa, pb);
      if (byGroup !== 0) return byGroup;
    }
    return sortWithinGroup(a, b);
  };
  today.sort(sortCrossProject);
  doing.sort(sortCrossProject);

  const groupsByProject = new Map<string, MyWorkStory<S>[]>();
  for (const story of rest) {
    const bucket = groupsByProject.get(story.projectId);
    if (bucket) bucket.push(story);
    else groupsByProject.set(story.projectId, [story]);
  }
  const todo: MyWorkGroup<S>[] = [...groupsByProject.entries()]
    .map(([projectId, groupStories]) => {
      const project = projectById.get(projectId);
      return {
        projectId,
        projectName: project?.name ?? "Unknown project",
        isPersonal: project?.isPersonal ?? false,
        stories: [...groupStories].sort(sortWithinGroup),
      };
    })
    .sort((a, b) =>
      compareGroup({ isPersonal: a.isPersonal, name: a.projectName }, { isPersonal: b.isPersonal, name: b.projectName }),
    );

  // Additive Done axis: real completions (incl. reassigned-away) + unmapped
  // local 'done' marks. A story can appear here AND in an active column when it
  // was completed before and is now reopened+assigned (AC #12b).
  return { todo, today, doing, done: [...completions, ...localDone] };
}

// One dnd-kit draggable card (TASK-132). Todo/Today/Doing use the bare story
// id as the dnd-kit id — classification guarantees a story sits in at most
// one of these three at a time. Done is additive (AC #11/#12): the same
// story can carry multiple completion entries, or one alongside its own
// live Doing card, so a Done item's id is synthesized (index + story id) to
// stay unique across the whole drag surface (all four columns share one
// DndContext, which requires globally-unique ids).
//
// `completedAt` is only meaningful on Done items ("" elsewhere, never read
// there) — kept as a plain required field rather than a second item type so
// every column shares one `T` for useOptimisticBoardOrder's single-type
// `Record<string, T[]>` state, and so groupDoneByDate (which wants
// `{completedAt: string}`) applies directly to `containers.done` with no cast.
export type MyWorkDragItem<S> = {
  id: string;
  storyId: string;
  completedAt: string;
  row: S;
};

export type MyWorkDragContainers<S> = Record<MyWorkColumn, MyWorkDragItem<S>[]>;

/**
 * Flattens classifyMyWork's output into the flat per-column item lists a
 * dnd-kit drag surface needs (doc-14 "Dragging a card"). Todo's per-project
 * grouping is a display concern layered back on top by `regroupByProject` —
 * the drag container itself is one flat list per column, matching how a
 * story only ever needs ONE list membership call (server-side reordering
 * within a column doesn't exist for My Work; only column membership changes).
 */
export function toDragContainers<S extends { id: string }>(columns: MyWorkColumns<S>): MyWorkDragContainers<S> {
  const activeItem = (s: MyWorkStory<S>): MyWorkDragItem<S> => ({ id: s.id, storyId: s.id, completedAt: "", row: s.row });
  return {
    todo: columns.todo.flatMap((g) => g.stories.map(activeItem)),
    today: columns.today.map(activeItem),
    doing: columns.doing.map(activeItem),
    done: columns.done.map((entry, i) => ({
      id: `done:${i}:${entry.row.id}`,
      storyId: entry.row.id,
      completedAt: entry.completedAt,
      row: entry.row,
    })),
  };
}

/**
 * Whether a drag-end should call the server, and with which target column
 * (TASK-132 fix — a real regression, not a hypothetical): the caller must
 * compare the column the card STARTED in (captured once at drag-start)
 * against the drop target, never a container re-derived from the live
 * `containers` state at drag-end — the drag-over handler already relocates
 * the card into the hovered column as the user drags, so by drag-end the
 * card's "current" container in that state is already the target, making a
 * naive current-vs-target comparison always equal (never persisting a move:
 * the card visually follows the cursor during the drag but silently reverts
 * once the page's data next refreshes, since nothing was ever sent to the
 * server). Returns null when there's nothing to persist (dropped back where
 * it started, or either side is unknown).
 */
export function resolveDragEndTarget(
  startContainer: MyWorkColumn | null,
  overContainer: MyWorkColumn | null,
): MyWorkColumn | null {
  if (!startContainer || !overContainer || startContainer === overContainer) return null;
  return overContainer;
}

/**
 * Re-derives Todo's per-project header blocks from a (possibly drag-
 * reordered) flat item list, grouping only CONSECUTIVE same-project items.
 * classifyMyWork's own order is already grouped-by-project, so this matches
 * the server order 1:1 at rest; a drag that inserts a card into the middle of
 * an unrelated project's run just gets its own single-item header until the
 * next server round-trip (revalidatePath) restores the canonical grouping —
 * a transient, self-correcting cosmetic gap, not a bug.
 */
export function regroupByProject<S extends { projectId: string; projectName: string }>(
  items: readonly MyWorkDragItem<S>[],
): { projectId: string; projectName: string; items: MyWorkDragItem<S>[] }[] {
  const groups: { projectId: string; projectName: string; items: MyWorkDragItem<S>[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.projectId === item.row.projectId) {
      last.items.push(item);
    } else {
      groups.push({ projectId: item.row.projectId, projectName: item.row.projectName, items: [item] });
    }
  }
  return groups;
}

export type DoneStory = { completedAt: string };
export type DoneDateGroup<S> = { dateKey: string; stories: S[] };

/**
 * Groups done entries by the UTC date of their `completedAt`, newest date
 * first and newest-within-date first — the Done column's date headers
 * (doc-14). `dateKey` is a YYYY-MM-DD string; the caller turns it into a
 * "Today"/"Yesterday"/date label (kept out of this pure function so it stays
 * framework/locale-free).
 */
export function groupDoneByDate<S extends DoneStory>(stories: readonly S[]): DoneDateGroup<S>[] {
  const byDate = new Map<string, S[]>();
  for (const story of stories) {
    const dateKey = story.completedAt.slice(0, 10);
    const bucket = byDate.get(dateKey);
    if (bucket) bucket.push(story);
    else byDate.set(dateKey, [story]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, groupStories]) => ({
      dateKey,
      stories: [...groupStories].sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    }));
}
