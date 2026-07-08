// Pure, framework-free helpers for the state-based kanban board (see
// spec/screens.md "Board layout"): column assignment and drag-drop
// validation. Shared by the client board (to block invalid drops visually)
// and the `dropStory` server action (which never trusts the client).

import { isUnestimatedFeature } from "./stories";
import {
  STORY_TRANSITION_ACTIONS,
  applyTransition,
  canTransition,
  type StoryState,
} from "./story-state";

export const BACKLOG_COLUMN_ID = "backlog";
export const ICEBOX_COLUMN_ID = "icebox";

// Board order, left to right. `rejected` only renders while non-empty.
export const STATE_COLUMNS = [
  "unstarted",
  "started",
  "finished",
  "delivered",
  "accepted",
  "rejected",
] as const;
export type StateColumnId = (typeof STATE_COLUMNS)[number];

export type KanbanColumnId =
  | StateColumnId
  | typeof BACKLOG_COLUMN_ID
  | typeof ICEBOX_COLUMN_ID;

export type KanbanStory = {
  state: string;
  story_type: string;
  points: number | null;
  iteration_id: string | null;
};

/**
 * The column a story belongs to. State columns hold only the current
 * iteration's stories; anything unscheduled is the Icebox and everything
 * else (no iteration, or a stray future iteration) is the Backlog.
 * Stories of finalized iterations belong to the history view, not the
 * board — callers exclude them before grouping.
 */
export function columnForStory(story: KanbanStory, currentIterationId: string | null): KanbanColumnId {
  if (story.state === "unscheduled") {
    return ICEBOX_COLUMN_ID;
  }
  if (currentIterationId && story.iteration_id === currentIterationId) {
    return story.state as StateColumnId;
  }
  return BACKLOG_COLUMN_ID;
}

export type DropEvaluation =
  | {
      ok: true;
      /** State to write, if the drop changes it. */
      state?: StoryState;
      /** Iteration assignment: move into the current iteration, out of any iteration, or leave as is. */
      iteration: "current" | "none" | "keep";
    }
  | { ok: false; reason: string };

/**
 * Validates dropping `story` (currently in `from`) onto column `to`.
 * Drag = state transition (spec/screens.md): only the valid next
 * transition(s) are accepted, plus the scheduling moves around
 * Backlog/Icebox. Same-column drops are reorders and always allowed.
 */
export function evaluateDrop(
  story: KanbanStory,
  from: KanbanColumnId,
  to: KanbanColumnId,
): DropEvaluation {
  if (from === to) {
    return { ok: true, iteration: "keep" };
  }

  if (to === ICEBOX_COLUMN_ID) {
    // Demoting to the Icebox is only meaningful for not-yet-started work —
    // checked on the story's actual state, not its origin column (TASK-19):
    // a story stuck `started` with no iteration still shows up in the
    // Backlog column (columnForStory falls through to it whenever
    // iteration_id doesn't match current), and `from === BACKLOG_COLUMN_ID`
    // alone used to demote it to the Icebox unconditionally, silently
    // discarding its in-progress state.
    if (story.state === "unstarted") {
      return { ok: true, state: "unscheduled", iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move to the icebox" };
  }

  if (to === BACKLOG_COLUMN_ID) {
    if (from === ICEBOX_COLUMN_ID) {
      return { ok: true, state: "unstarted", iteration: "none" };
    }
    if (from === "unstarted") {
      // Un-schedule from the current iteration; the state stays unstarted.
      return { ok: true, iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move back to the backlog" };
  }

  const targetState = to;

  if (targetState === "started" && isUnestimatedFeature(story.story_type, story.points)) {
    return { ok: false, reason: "Estimate this feature before starting it" };
  }

  if (from === ICEBOX_COLUMN_ID) {
    if (targetState === "unstarted") {
      return { ok: true, state: "unstarted", iteration: "current" };
    }
    return { ok: false, reason: "Icebox stories must be scheduled before other transitions" };
  }

  if (from === BACKLOG_COLUMN_ID) {
    if (targetState === "unstarted") {
      return { ok: true, iteration: "current" };
    }
    if (targetState === "started") {
      // Assign to the current iteration and start in one gesture.
      return { ok: true, state: "started", iteration: "current" };
    }
    return { ok: false, reason: "Backlog stories can only be scheduled or started" };
  }

  // State column -> state column: must be a valid one-step transition.
  const fromState = from as StoryState;
  const action = STORY_TRANSITION_ACTIONS.find(
    (a) => canTransition(fromState, a) && applyTransition(fromState, a) === targetState,
  );
  if (!action) {
    return { ok: false, reason: `Cannot move a ${from} story to ${to}` };
  }
  return { ok: true, state: targetState, iteration: "keep" };
}

// List view (see spec/screens.md "Board layout: List view") merges all
// current-iteration state columns into one "current" zone so state renders
// as a badge instead of a physical column — priority is a single position
// order spanning every state, matching Pivotal Tracker's backlog list.
export type ListZoneId = "current" | typeof BACKLOG_COLUMN_ID | typeof ICEBOX_COLUMN_ID;

export function zoneForStory(story: KanbanStory, currentIterationId: string | null): ListZoneId {
  if (story.state === "unscheduled") {
    return ICEBOX_COLUMN_ID;
  }
  if (currentIterationId && story.iteration_id === currentIterationId) {
    return "current";
  }
  return BACKLOG_COLUMN_ID;
}

export type ListDropEvaluation =
  | { ok: true; state?: StoryState; iteration: "current" | "none" | "keep" }
  | { ok: false; reason: string };

/**
 * Validates a List-view drop across zones. Unlike `evaluateDrop`, a
 * same-zone drop is always a plain reorder regardless of the individual
 * stories' states (the zone doesn't encode state) — only crossing a zone
 * boundary can change state/iteration, and only for `unstarted` stories,
 * mirroring the Icebox/Backlog/Unstarted rules in `evaluateDrop`.
 */
export function evaluateListDrop(
  story: KanbanStory,
  from: ListZoneId,
  to: ListZoneId,
): ListDropEvaluation {
  if (from === to) {
    return { ok: true, iteration: "keep" };
  }

  if (to === ICEBOX_COLUMN_ID) {
    // Checked on state alone, regardless of origin zone (TASK-19) — a
    // story stuck `started` with no iteration still shows up in the
    // Backlog zone (zoneForStory falls through to it whenever iteration_id
    // doesn't match current); `from === BACKLOG_COLUMN_ID` alone used to
    // demote it to the Icebox unconditionally, discarding its progress.
    if (story.state === "unstarted") {
      return { ok: true, state: "unscheduled", iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move to the icebox" };
  }

  if (to === BACKLOG_COLUMN_ID) {
    if (from === ICEBOX_COLUMN_ID) {
      return { ok: true, state: "unstarted", iteration: "none" };
    }
    if (from === "current" && story.state === "unstarted") {
      return { ok: true, iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move back to the backlog" };
  }

  // to === "current"
  if (from === ICEBOX_COLUMN_ID) {
    return { ok: true, state: "unstarted", iteration: "current" };
  }
  if (from === BACKLOG_COLUMN_ID) {
    return { ok: true, iteration: "current" };
  }
  return { ok: false, reason: `Cannot move a ${from} story to ${to}` };
}

/**
 * Merges the current iteration's per-state-column buckets into one flat list
 * ordered by `position` (TASK-21) — matching spec/screens.md "List view":
 * "every state ... in one flat, priority-ordered list". Concatenating the
 * buckets in `STATE_COLUMNS` order (as the List view used to) instead
 * produces a state-bucketed order, wrongly rendering e.g. a `started` story
 * below an `unstarted` one at a lower position.
 */
export function flattenCurrentZone<T extends { position: number }>(
  containers: Record<string, ReadonlyArray<T>>,
): T[] {
  return STATE_COLUMNS.flatMap((column) => containers[column] ?? []).sort((a, b) => a.position - b.position);
}

/** Buckets current-iteration stories into their state columns, preserving input order. */
export function groupByStateColumn<T extends { state: string }>(
  stories: ReadonlyArray<T>,
): Record<StateColumnId, T[]> {
  const grouped = {
    unstarted: [],
    started: [],
    finished: [],
    delivered: [],
    accepted: [],
    rejected: [],
  } as Record<StateColumnId, T[]>;
  for (const story of stories) {
    const bucket = grouped[story.state as StateColumnId];
    if (bucket) {
      bucket.push(story);
    }
  }
  return grouped;
}
