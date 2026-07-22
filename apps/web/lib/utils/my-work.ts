// Pure classification/ordering logic for the My Work screen (doc-15 "My Work
// redesign — personal board with free columns"). Framework-free like the rest
// of lib/utils — the page (server) shapes DB rows into these types, calls
// classifyMyWork, and hands the columns to the renderer.
//
// doc-15 dropped the project-board mapping entirely: My Work is now a purely
// personal board. Placement is manual (doc-15 decisions 2/5): a story lands in
// Today (today_date = the viewer's local today), else its free column
// (my_work_columns via column_id), else Todo. Done is the viewer's completion
// history only (story_completions) — real-done stories are excluded upstream
// (the page's `completed_at is null` filter), so no active card is ever
// real-done and classification never routes by category.

export type MyWorkStructuralColumn = "todo" | "today" | "done";
// A drag container / drop target id: one of the three structural columns, or a
// free column's uuid.
export type MyWorkColumnId = MyWorkStructuralColumn | (string & {});

// A user-defined free column (my_work_columns). Todo/Today/Done are structural
// slots, not rows; everything else (seeded 'Doing' + any the user adds) is one
// of these, ordered by `position`.
export type MyWorkFreeColumn = { id: string; name: string; position: number };

export type MyWorkProject = {
  id: string;
  name: string;
  // The viewer's own personal project (projects.is_personal AND created_by =
  // viewer, resolved by the page — TASK-103). Sorts groups first.
  isPersonal: boolean;
};

// An assigned, non-Icebox, non-done story in the viewer's My Work base scope,
// plus the per-viewer marks needed to place it. `S` is the render payload the
// page attaches.
export type MyWorkStory<S = unknown> = {
  id: string;
  projectId: string;
  position: number;
  // The viewer's Today mark for a specific calendar date (doc-15 decision 4).
  // A card is in Today only when this equals the viewer's local today; a stale
  // (past) date falls back to the card's column and surfaces the carry-over
  // prompt instead.
  todayDate: string | null;
  // Manual order within the Today column (the day's execution order).
  todayPosition: number | null;
  // The free column this card sits in (my_work_story_state.column_id), or null
  // for Todo. null also covers a card whose column was deleted (the composite
  // FK's SET NULL drops it back to Todo).
  columnId: string | null;
  row: S;
};

export type MyWorkGroup<S> = {
  projectId: string;
  projectName: string;
  isPersonal: boolean;
  stories: MyWorkStory<S>[];
};

// A Done entry — a story_completions row, live-joined to the story's current
// data by the page so a reassigned-away completion still renders.
export type DoneEntry<S> = { completedAt: string; row: S };

export type MyWorkFreeColumnGroup<S> = { column: MyWorkFreeColumn; stories: MyWorkStory<S>[] };

export type MyWorkColumns<S> = {
  todo: MyWorkGroup<S>[];
  today: MyWorkStory<S>[];
  free: MyWorkFreeColumnGroup<S>[];
  done: DoneEntry<S>[];
};

function compareGroup(a: { isPersonal: boolean; name: string }, b: { isPersonal: boolean; name: string }): number {
  if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Splits the viewer's assigned active stories + their completion history into
 * My Work's columns (doc-15). Placement precedence per story: Today (today_date
 * = todayKey) > its free column (column_id) > Todo. `completions` is one entry
 * per story_completions row, live-joined by the caller. `freeColumns` are the
 * viewer's own columns, ordered; a card pointing at an unknown column falls to
 * Todo (shouldn't happen — the composite FK guarantees ownership).
 */
export function classifyMyWork<S>(
  assigned: readonly MyWorkStory<S>[],
  completions: readonly DoneEntry<S>[],
  projects: readonly MyWorkProject[],
  freeColumns: readonly MyWorkFreeColumn[],
  todayKey: string,
): MyWorkColumns<S> {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const orderedColumns = [...freeColumns].sort((a, b) => a.position - b.position);
  const columnSet = new Set(orderedColumns.map((c) => c.id));

  const today: MyWorkStory<S>[] = [];
  const byColumn = new Map<string, MyWorkStory<S>[]>();
  const rest: MyWorkStory<S>[] = [];
  for (const story of assigned) {
    if (story.todayDate === todayKey) {
      today.push(story);
    } else if (story.columnId && columnSet.has(story.columnId)) {
      const bucket = byColumn.get(story.columnId);
      if (bucket) bucket.push(story);
      else byColumn.set(story.columnId, [story]);
    } else {
      rest.push(story);
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

  // Today is manually ordered (doc-15 decision 4): today_position asc, nulls
  // last (a freshly-marked card with no position yet sinks to the bottom),
  // ties broken by the cross-project order.
  today.sort((a, b) => {
    const pa = a.todayPosition;
    const pb = b.todayPosition;
    if (pa !== pb) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    }
    return sortCrossProject(a, b);
  });

  const free: MyWorkFreeColumnGroup<S>[] = orderedColumns.map((column) => ({
    column,
    stories: (byColumn.get(column.id) ?? []).sort(sortCrossProject),
  }));

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

  return { todo, today, free, done: [...completions] };
}

// One dnd-kit draggable card (TASK-132). Todo/Today/free columns use the bare
// story id as the dnd-kit id — classification guarantees a story sits in at
// most one of these at a time. Done is additive (a story can carry multiple
// completion entries, or one alongside its own live card), so a Done item's id
// is synthesized (index + story id) to stay unique across the whole drag
// surface (all columns share one DndContext, which requires globally-unique ids).
//
// `completedAt` is only meaningful on Done items ("" elsewhere, never read
// there) — kept as a plain required field rather than a second item type so
// every column shares one `T` for useOptimisticBoardOrder's single-type state.
export type MyWorkDragItem<S> = {
  id: string;
  storyId: string;
  completedAt: string;
  row: S;
};

// Keyed by container id: "todo" / "today" / "done" plus each free column's uuid.
export type MyWorkDragContainers<S> = Record<string, MyWorkDragItem<S>[]>;

/**
 * Flattens classifyMyWork's output into the flat per-column item lists a
 * dnd-kit drag surface needs. Todo's per-project grouping is layered back on
 * top by `regroupByProject` — the drag container itself is one flat list per
 * column, matching how a story only ever needs ONE list membership call
 * (My Work has no persisted within-column position except Today's, which is
 * written from the drop order server-side).
 */
export function toDragContainers<S extends { id: string }>(columns: MyWorkColumns<S>): MyWorkDragContainers<S> {
  const activeItem = (s: MyWorkStory<S>): MyWorkDragItem<S> => ({ id: s.id, storyId: s.id, completedAt: "", row: s.row });
  const containers: MyWorkDragContainers<S> = {
    todo: columns.todo.flatMap((g) => g.stories.map(activeItem)),
    today: columns.today.map(activeItem),
    done: columns.done.map((entry, i) => ({
      id: `done:${i}:${entry.row.id}`,
      storyId: entry.row.id,
      completedAt: entry.completedAt,
      row: entry.row,
    })),
  };
  for (const group of columns.free) containers[group.column.id] = group.stories.map(activeItem);
  return containers;
}

/**
 * Whether a drag-end should call the server, and with which target column
 * (TASK-132 fix): the caller must compare the column the card STARTED in
 * (captured once at drag-start) against the drop target, never a container
 * re-derived from the live `containers` state at drag-end — the drag-over
 * handler already relocates the card into the hovered column as the user
 * drags, so by drag-end a naive current-vs-target comparison is always equal
 * (never persisting a move). Returns null when there's nothing to persist.
 */
export function resolveDragEndTarget(
  startContainer: MyWorkColumnId | null,
  overContainer: MyWorkColumnId | null,
): MyWorkColumnId | null {
  if (!startContainer || !overContainer || startContainer === overContainer) return null;
  return overContainer;
}

/**
 * Re-derives Todo's per-project header blocks from a (possibly drag-reordered)
 * flat item list, grouping only CONSECUTIVE same-project items. classifyMyWork's
 * own order is already grouped-by-project, so this matches the server order 1:1
 * at rest; a mid-drag insert just gets its own single-item header until the next
 * server round-trip restores the canonical grouping — a transient, self-
 * correcting cosmetic gap, not a bug.
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
 * Groups done entries by the UTC date of their `completedAt`, newest date first
 * and newest-within-date first — the Done column's date headers. `dateKey` is a
 * YYYY-MM-DD string; the caller turns it into a "Today"/"Yesterday"/date label.
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
