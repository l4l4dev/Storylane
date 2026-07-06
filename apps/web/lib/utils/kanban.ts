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
    // Demoting to the Icebox is only meaningful for not-yet-started work.
    if (from === BACKLOG_COLUMN_ID || from === "unstarted") {
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
