import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { projects, stories, type StoryList } from "../db/schema";
import { HttpError } from "../http-error";
import type { ProjectTx } from "../db/tx";

/**
 * Sparse spacing, so an ordinary drop between two neighbours is one UPDATE. Wide enough that a
 * list is renumbered roughly once per ten consecutive drops into the same seam, narrow enough
 * that a 32-bit position still holds two million stories.
 */
export const POSITION_GAP = 1024;

export interface MoveRequest {
  group?: "scheduled" | "unscheduled" | "current";
  after_id?: string | null;
  before_id?: string | null;
}

export function listForGroup(tx: ProjectTx, group: MoveRequest["group"]): StoryList | undefined {
  if (group === undefined) return undefined;
  if (group === "unscheduled") return "icebox";
  if (group === "current") {
    const automatic = tx.tx
      .select({ v: projects.automaticPlanning })
      .from(projects)
      .where(eq(projects.id, tx.projectId))
      .get();
    // Current is the head of the backlog list, cut by planning: while planning is automatic a
    // client cannot pin a story there (Assumption 7).
    if (automatic?.v) throw new HttpError(409, "manual_planning_required");
  }
  return "backlog";
}

function neighbourPosition(tx: ProjectTx, list: StoryList, id: string): number {
  const row = tx.tx
    .select({ list: stories.list, position: stories.position })
    .from(stories)
    .where(and(eq(stories.id, id), eq(stories.projectId, tx.projectId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  if (row.list !== list) throw new HttpError(400, "neighbour_not_in_list");
  return row.position;
}

/**
 * The occupied position closest to `from` on one side, ignoring the story being moved (it is
 * about to leave its own slot, so it must not narrow the seam it is moving into).
 */
function closestPosition(
  tx: ProjectTx,
  list: StoryList,
  storyId: string,
  side: "above" | "below",
  from: number,
): number | null {
  const bound = side === "above" ? gt(stories.position, from) : lt(stories.position, from);
  const row = tx.tx
    .select({
      p: side === "above" ? sql<number | null>`min(${stories.position})` : sql<number | null>`max(${stories.position})`,
    })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.list, list), ne(stories.id, storyId), bound))
    .get();
  return row?.p ?? null;
}

/** Two passes through negative positions: SQLite has no deferrable UNIQUE. */
function renumber(tx: ProjectTx, list: StoryList): void {
  const ids = tx.tx
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.list, list)))
    .orderBy(asc(stories.position))
    .all()
    .map((r) => r.id);
  ids.forEach((id, rank) => {
    tx.tx
      .update(stories)
      .set({ position: -rank - 1 })
      .where(and(eq(stories.id, id), eq(stories.projectId, tx.projectId)))
      .run();
  });
  ids.forEach((id, rank) => {
    tx.tx
      .update(stories)
      .set({ position: (rank + 1) * POSITION_GAP })
      .where(and(eq(stories.id, id), eq(stories.projectId, tx.projectId)))
      .run();
  });
}

export function appendToList(tx: ProjectTx, list: StoryList): number {
  const row = tx.tx
    .select({ p: sql<number | null>`max(${stories.position})` })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.list, list)))
    .get();
  // Positions start at POSITION_GAP, never 0, so there is always room to insert a new head.
  return row?.p === null || row?.p === undefined ? POSITION_GAP : row.p + POSITION_GAP;
}

/** The free seam adjacent to the named neighbour, or null when that seam holds no integer. */
function between(lower: number | null, upper: number | null): number | null {
  if (lower === null && upper === null) return POSITION_GAP;
  if (lower === null) {
    if (upper! > POSITION_GAP) return upper! - POSITION_GAP;
    const head = Math.floor(upper! / 2);
    return head > 0 ? head : null;
  }
  if (upper === null) return lower + POSITION_GAP;
  const mid = Math.floor((lower + upper) / 2);
  return mid > lower && mid < upper ? mid : null;
}

/**
 * The seam the move actually lands in: bounded by the named neighbour on its own side and by
 * whatever currently occupies the next slot on the other. Midpointing the two *named* positions
 * instead would give two moves into the same seam the same answer, and the second would collide
 * on UNIQUE (project_id, list, position); anchoring on the named side makes them stack in
 * commit order.
 */
function seam(
  tx: ProjectTx,
  list: StoryList,
  storyId: string,
  afterId: string | null,
  beforeId: string | null,
): { lower: number | null; upper: number | null } {
  if (afterId !== null) {
    const lower = neighbourPosition(tx, list, afterId);
    return { lower, upper: closestPosition(tx, list, storyId, "above", lower) };
  }
  const upper = neighbourPosition(tx, list, beforeId!);
  return { lower: closestPosition(tx, list, storyId, "below", upper), upper };
}

/**
 * Tracker's own move vocabulary (core-model §1.8): `after_id` is the predecessor, `before_id`
 * the successor, and the client never sends the whole list. Positions are read *inside* this
 * transaction, so a client working from a stale snapshot still lands next to the neighbours it
 * named rather than overwriting an interleaved move. It returns the position and writes nothing:
 * the story's `list`, `current_state` and `position` must move in one UPDATE or the
 * `stories_icebox_is_unscheduled_update` trigger sees an inconsistent half-move and aborts.
 */
export function placeInList(tx: ProjectTx, storyId: string, list: StoryList, move: MoveRequest): number {
  const afterId = move.after_id ?? null;
  const beforeId = move.before_id ?? null;
  if (afterId === storyId || beforeId === storyId) throw new HttpError(400, "neighbour_is_self");
  if (afterId === null && beforeId === null) return appendToList(tx, list);

  if (afterId !== null && beforeId !== null) {
    if (neighbourPosition(tx, list, afterId) >= neighbourPosition(tx, list, beforeId)) {
      throw new HttpError(400, "neighbours_out_of_order");
    }
  }

  let bounds = seam(tx, list, storyId, afterId, beforeId);
  let position = between(bounds.lower, bounds.upper);
  if (position === null) {
    // The seam is full. Renumbering is the exception, not the write path: it touches the whole
    // list, and it happens inside this same transaction so no reader sees half a renumbering.
    renumber(tx, list);
    bounds = seam(tx, list, storyId, afterId, beforeId);
    position = between(bounds.lower, bounds.upper);
    if (position === null) throw new Error("positions exhausted after renumbering");
  }
  return position;
}
