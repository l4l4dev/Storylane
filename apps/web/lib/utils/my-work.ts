// Pure classification/ordering logic for the My Work screen (doc-15 "My Work
// redesign — personal board with free columns"). Framework-free like the rest
// of lib/utils — the page (server) shapes DB rows into these types, calls
// classifyMyWork, and hands the columns to the renderer.
//
// doc-15 dropped the project-board mapping entirely: My Work is now a purely
// personal board. Placement per story (classifyMyWork): Done (the story's real
// state category is `done`) first and exclusively, else Today (today_date = the
// viewer's local today), else its free column (my_work_columns via column_id),
// else Todo. Done became a plain status column (owner decision 2026-07-24,
// TASK-176) — a done story shows there and nowhere else, read straight from the
// story's live done category, NOT a separate append-only story_completions log.

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

// An assigned, non-Icebox story in the viewer's My Work base scope, plus the
// per-viewer marks needed to place it. `S` is the render payload the page
// attaches. Done is now an exclusive status column (owner decision 2026-07-24),
// so a done story carries `isDone`/`completedAt` and classifies to Done and
// nowhere else — not a separate log entry alongside a live card.
export type MyWorkStory<S = unknown> = {
  id: string;
  projectId: string;
  position: number;
  // Whether the story's real state category is `done` — routes it to the Done
  // column exclusively. `completedAt` is the timestamp Done groups its date
  // sections by (set iff isDone).
  isDone: boolean;
  completedAt: string | null;
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
  // Manual order within its free column — same role as todayPosition,
  // generalized to any user-defined column.
  columnPosition: number | null;
  // Manual order within Todo (TASK-177) and within a Done date group
  // (TASK-176). Each is nulls-last, falling back to board `position` (Todo) or
  // completedAt-desc (Done) for a never-reordered card.
  todoPosition: number | null;
  donePosition: number | null;
  row: S;
};

export type MyWorkGroup<S> = {
  projectId: string;
  projectName: string;
  isPersonal: boolean;
  stories: MyWorkStory<S>[];
};

// The Done reach-back window default (profiles.my_work_done_window_days is
// user-configurable; this is the fallback when that row is unavailable, e.g.
// no signed-in user).
export const DEFAULT_DONE_WINDOW_DAYS = 7;

export type MyWorkFreeColumnGroup<S> = { column: MyWorkFreeColumn; stories: MyWorkStory<S>[] };

export type MyWorkColumns<S> = {
  todo: MyWorkGroup<S>[];
  today: MyWorkStory<S>[];
  free: MyWorkFreeColumnGroup<S>[];
  // Done stories in render order: newest completion date first, then each
  // date's manual order (donePosition), then newest-within-date. The renderer
  // groups them into date sections with groupDoneByDate (preserving this order).
  done: MyWorkStory<S>[];
};

function compareGroup(a: { isPersonal: boolean; name: string }, b: { isPersonal: boolean; name: string }): number {
  if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// Shared shape for Today/free-column manual ordering: ascending by position,
// nulls last (an unpositioned card sinks to the bottom), ties broken by
// `fallback`.
function sortByManualPosition<S>(a: S, b: S, pa: number | null, pb: number | null, fallback: (a: S, b: S) => number): number {
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  return fallback(a, b);
}

/**
 * Splits the viewer's assigned stories into My Work's columns. Placement
 * precedence per story: Done (real state category is done) > Today (today_date
 * = todayKey) > its free column (column_id) > Todo. Done is checked FIRST and
 * is exclusive (owner decision 2026-07-24): a team story completed on its own
 * board never goes through My Work's write path, so its local today_date /
 * column_id are NOT cleared — routing by those first would wrongly show a done
 * story in Today or a free column. `freeColumns` are the viewer's own columns,
 * ordered; a card pointing at an unknown column falls to Todo (shouldn't
 * happen — the composite FK guarantees ownership).
 */
export function classifyMyWork<S>(
  assigned: readonly MyWorkStory<S>[],
  projects: readonly MyWorkProject[],
  freeColumns: readonly MyWorkFreeColumn[],
  todayKey: string,
): MyWorkColumns<S> {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const orderedColumns = [...freeColumns].sort((a, b) => a.position - b.position);
  const columnSet = new Set(orderedColumns.map((c) => c.id));

  const done: MyWorkStory<S>[] = [];
  const today: MyWorkStory<S>[] = [];
  const byColumn = new Map<string, MyWorkStory<S>[]>();
  const rest: MyWorkStory<S>[] = [];
  for (const story of assigned) {
    if (story.isDone) {
      done.push(story);
    } else if (story.todayDate === todayKey) {
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
  // ties broken by the cross-project order. Free columns use the same manual-
  // order-with-fallback shape, keyed by columnPosition instead.
  today.sort((a, b) => sortByManualPosition(a, b, a.todayPosition, b.todayPosition, sortCrossProject));

  const free: MyWorkFreeColumnGroup<S>[] = orderedColumns.map((column) => ({
    column,
    stories: (byColumn.get(column.id) ?? []).sort((a, b) =>
      sortByManualPosition(a, b, a.columnPosition, b.columnPosition, sortCrossProject),
    ),
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
        // A project the viewer has since left reads as an expected state
        // ("you left this"), not an error (doc-17 #40).
        projectName: project?.name ?? "Left project",
        isPersonal: project?.isPersonal ?? false,
        // Manual order within the group (TASK-177): todoPosition asc, nulls
        // last (a never-reordered card falls back to its board position).
        stories: [...groupStories].sort((a, b) =>
          sortByManualPosition(a, b, a.todoPosition, b.todoPosition, sortWithinGroup),
        ),
      };
    })
    .sort((a, b) =>
      compareGroup({ isPersonal: a.isPersonal, name: a.projectName }, { isPersonal: b.isPersonal, name: b.projectName }),
    );

  // Done render order (TASK-176): newest completion date first, then within a
  // date the manual order (donePosition, nulls last), then newest-within-date.
  // groupDoneByDate preserves this order when it slices into date sections.
  const doneDateKey = (s: MyWorkStory<S>) => (s.completedAt ?? "").slice(0, 10);
  done.sort((a, b) => {
    const da = doneDateKey(a);
    const db = doneDateKey(b);
    if (da !== db) return db.localeCompare(da);
    return sortByManualPosition(a, b, a.donePosition, b.donePosition, (x, y) =>
      (y.completedAt ?? "").localeCompare(x.completedAt ?? ""),
    );
  });

  return { todo, today, free, done };
}

// One dnd-kit draggable card. Every column uses the bare story id as the
// dnd-kit id — Done is now an exclusive status column (owner decision
// 2026-07-24), so a story sits in exactly one container and ids are globally
// unique without synthesizing (all columns share one DndContext, which
// requires unique ids).
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
 * dnd-kit drag surface needs. Todo's per-project grouping and Done's per-date
 * grouping are layered back on top by the renderer (regroupByProject /
 * groupDoneByDate) — the drag container itself is one flat list per column,
 * matching how a story only ever needs ONE list membership call.
 */
export function toDragContainers<S extends { id: string }>(columns: MyWorkColumns<S>): MyWorkDragContainers<S> {
  const item = (s: MyWorkStory<S>): MyWorkDragItem<S> => ({
    id: s.id,
    storyId: s.id,
    completedAt: s.completedAt ?? "",
    row: s.row,
  });
  const containers: MyWorkDragContainers<S> = {
    todo: columns.todo.flatMap((g) => g.stories.map(item)),
    today: columns.today.map(item),
    done: columns.done.map(item),
  };
  for (const group of columns.free) containers[group.column.id] = group.stories.map(item);
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
 * Whether Done is a valid drag-OVER target for this card (doc-17 #10): a team
 * story's drop there is rejected outright by setMyWorkColumn (it completes
 * only on its own board), so letting the drag-over UI accept it first would
 * be a false affordance — the card would visibly enter Done, then snap back
 * once the drop is rejected. Gating it here means it's never a valid target
 * to begin with, for a team card; a personal card is unaffected.
 */
export function canDropOnDone(isPersonal: boolean): boolean {
  return isPersonal;
}

/**
 * Whether a rejected drop should offer a link to the story's own board rather
 * than a dead-end message (TASK-173, ux-principles principle 8): only when a
 * TEAM card is dragged OUT of Done — that's the one case setMyWorkColumn
 * rejects because the story can only be reopened on its board. A personal Done
 * card reopens in place (never rejected), and a team card dragged anywhere but
 * out of Done fails for other reasons that a board link wouldn't fix.
 */
export function isTeamDoneOutRejection(startContainer: MyWorkColumnId | null, isPersonal: boolean): boolean {
  return startContainer === "done" && !isPersonal;
}

/**
 * Whether a same-container drop should persist a manual reorder. Every column
 * now carries its own persisted card order: Today (today_position), free
 * columns (column_position), Todo (todo_position, TASK-177), and Done
 * (done_position, TASK-176). So any same-container drop persists a reorder —
 * the null cases are cross-container moves (handled by resolveDragEndTarget)
 * and drops back onto the start container (no-op).
 */
export function isManualOrderReorder(startContainer: MyWorkColumnId | null, overContainer: MyWorkColumnId | null): boolean {
  return startContainer !== null && startContainer === overContainer;
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
 * Groups done entries by the UTC date of their `completedAt`, newest date
 * first, PRESERVING the caller's within-date order — the Done column's date
 * headers. The caller (classifyMyWork, or the optimistic drag container mid-
 * reorder) already sorts within a date by the manual donePosition (TASK-176),
 * so this must not re-sort by completedAt or it would clobber a manual reorder.
 * `dateKey` is a YYYY-MM-DD string; the caller turns it into a
 * "Today"/"Yesterday"/date label.
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
    .map(([dateKey, groupStories]) => ({ dateKey, stories: groupStories }));
}

// The three structural slots in their default relative order, interleaved with
// free columns (by their own `position`) between Today and Done.
// "done" is deliberately never part of this order (TASK-155): Done always
// renders last, fixed — the user reorders CARDS within it (donePosition) but
// not the Done column's own position among Todo/Today/free columns.
function defaultOrder(freeColumns: readonly MyWorkFreeColumn[]): string[] {
  const sortedFree = [...freeColumns].sort((a, b) => a.position - b.position).map((c) => c.id);
  return ["todo", "today", ...sortedFree];
}

/**
 * Resolves the viewer's display order for the REORDERABLE columns — Todo,
 * Today, and the free columns ("done" is deliberately excluded, see
 * defaultOrder above). `stored` is `profiles.my_work_column_order` as written
 * by the last reorder; it's read-side merged against the LIVE free column set
 * so the order never needs its own migration when a column is added or
 * deleted: stale ids (a deleted column, or "done" from before it was excluded)
 * are dropped, and any id not yet in `stored` (a newly added column, or a
 * user who has never reordered anything) is appended in its default position.
 */
// Display-name overrides for the three FIXED slots — the slot id/behavior
// never changes, only its label.
export type MyWorkColumnNames = { todo: string; today: string; done: string };
export const DEFAULT_COLUMN_NAMES: MyWorkColumnNames = { todo: "Todo", today: "Today", done: "Done" };

/**
 * Reads `profiles.my_work_column_names` (a jsonb map, shape unvalidated at
 * the DB layer) defensively: any key missing or not a non-empty string falls
 * back to the default label, so a malformed/partial value degrades
 * gracefully instead of blanking a column's name.
 */
export function resolveColumnNames(stored: unknown): MyWorkColumnNames {
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const pick = (slot: keyof MyWorkColumnNames): string => {
    const value = raw[slot];
    return typeof value === "string" && value.trim() ? value : DEFAULT_COLUMN_NAMES[slot];
  };
  return { todo: pick("todo"), today: pick("today"), done: pick("done") };
}

export function resolveColumnOrder(stored: readonly string[], freeColumns: readonly MyWorkFreeColumn[]): string[] {
  // "done" is excluded even if present in an old stored order (from before
  // TASK-155) — it's dropped like any other no-longer-valid id, since Done
  // is no longer part of the reorderable set.
  const validIds = new Set<string>(["todo", "today", ...freeColumns.map((c) => c.id)]);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of stored) {
    if (validIds.has(id) && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const id of defaultOrder(freeColumns)) {
    if (!seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  return order;
}
