// Pure, framework-free helpers for the state-based kanban board (see
// spec/screens.md "Board layout"): column assignment and drag-drop
// validation. Shared by the client board (to block invalid drops visually)
// and the `dropStory` server action (which never trusts the client).

import { isUnestimatedFeature } from "./stories";
import { computeStateGate, type GateState, type StateCategory } from "@storylane/core";
import type { ProjectState } from "@/lib/types";

export const BACKLOG_COLUMN_ID = "backlog";
export const ICEBOX_COLUMN_ID = "icebox";

// A state column's id IS the project_states row's id — the column set is
// per-project and data-driven (TASK-91), not a fixed 6-value list.
export type StateColumnId = string;

export type KanbanColumnId =
  | StateColumnId
  | typeof BACKLOG_COLUMN_ID
  | typeof ICEBOX_COLUMN_ID;

export type KanbanStory = {
  state_id: string | null;
  story_type: string;
  points: number | null;
  iteration_id: string | null;
};

/** `ProjectState[]` (the DB row shape) -> `GateState[]` (computeStateGate's input shape). */
export function toGateStates(states: ReadonlyArray<ProjectState>): GateState[] {
  return states.map((s) => ({ id: s.id, category: s.category, actionLabel: s.action_label, position: s.position }));
}

function categoryOf(stateId: string | null, states: ReadonlyArray<GateState>): StateCategory | null {
  if (stateId === null) return null;
  return states.find((s) => s.id === stateId)?.category ?? null;
}

/** The project's lowest-position unstarted-category state — where Icebox/Backlog stories schedule into. */
export function lowestUnstartedStateId(states: ReadonlyArray<GateState>): string | null {
  const candidates = states.filter((s) => s.category === "unstarted").sort((a, b) => a.position - b.position);
  return candidates[0]?.id ?? null;
}

/**
 * The column a story belongs to. State columns hold only the current
 * iteration's stories; anything with no state (Icebox) is the Icebox and
 * everything else (no iteration, or a stray future iteration) is the
 * Backlog. Stories of finalized iterations belong to the history view, not
 * the board — callers exclude them before grouping.
 */
export function columnForStory(story: KanbanStory, currentIterationId: string | null): KanbanColumnId {
  if (story.state_id === null) {
    return ICEBOX_COLUMN_ID;
  }
  if (currentIterationId && story.iteration_id === currentIterationId) {
    return story.state_id;
  }
  return BACKLOG_COLUMN_ID;
}

export type DropEvaluation =
  | {
      ok: true;
      /** State to write, if the drop changes it (undefined = unchanged; null = Icebox). */
      state_id?: string | null;
      /** Iteration assignment: move into the current iteration, out of any iteration, or leave as is. */
      iteration: "current" | "none" | "keep";
    }
  | { ok: false; reason: string };

/**
 * Validates dropping `story` (currently in `from`) onto column `to`.
 * State-column-to-state-column drops accept any target state (spec/
 * screens.md "Drag = set state" — ordering discipline lives in the UI
 * advance button, `computeStateGate`, not in the drop), plus the
 * scheduling moves around Backlog/Icebox. Same-column drops are reorders
 * and always allowed.
 */
export function evaluateDrop(
  story: KanbanStory,
  from: KanbanColumnId,
  to: KanbanColumnId,
  states: ReadonlyArray<GateState>,
): DropEvaluation {
  if (from === to) {
    return { ok: true, iteration: "keep" };
  }

  function estimationGate(targetStateId: string | null): DropEvaluation | null {
    if (!isUnestimatedFeature(story.story_type, story.points)) return null;
    const targetCategory = categoryOf(targetStateId, states);
    if (targetCategory !== null && targetCategory !== "unstarted") {
      return { ok: false, reason: "Estimate this feature before starting it" };
    }
    return null;
  }

  if (to === ICEBOX_COLUMN_ID) {
    // Demoting to the Icebox is only meaningful for not-yet-started work —
    // checked on the story's actual state, not its origin column: a story
    // stuck mid-iteration with no iteration_id still shows up in the
    // Backlog column (columnForStory falls through to it whenever
    // iteration_id doesn't match current), so checking `from ===
    // BACKLOG_COLUMN_ID` alone would demote it to the Icebox
    // unconditionally, silently discarding its in-progress state.
    if (categoryOf(story.state_id, states) === "unstarted") {
      return { ok: true, state_id: null, iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move to the icebox" };
  }

  if (to === BACKLOG_COLUMN_ID) {
    if (from === ICEBOX_COLUMN_ID) {
      const target = lowestUnstartedStateId(states);
      if (!target) return { ok: false, reason: "This project has no unstarted state to schedule into" };
      return { ok: true, state_id: target, iteration: "none" };
    }
    if (categoryOf(story.state_id, states) === "unstarted") {
      // Un-schedule from the current iteration; the state stays unchanged.
      return { ok: true, iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move back to the backlog" };
  }

  const targetStateId = to;

  if (from === ICEBOX_COLUMN_ID) {
    if (targetStateId !== lowestUnstartedStateId(states)) {
      return { ok: false, reason: "Icebox stories must be scheduled before other transitions" };
    }
    const blocked = estimationGate(targetStateId);
    if (blocked) return blocked;
    return { ok: true, state_id: targetStateId, iteration: "current" };
  }

  if (from === BACKLOG_COLUMN_ID) {
    if (targetStateId === story.state_id) {
      return { ok: true, iteration: "current" };
    }
    // Assign to the current iteration and advance in one gesture — only the
    // gate-offered next state from the story's current one is valid.
    const gate = computeStateGate(states, story.state_id);
    if (gate.kind === "advance" && gate.targetStateId === targetStateId) {
      const blocked = estimationGate(targetStateId);
      if (blocked) return blocked;
      return { ok: true, state_id: targetStateId, iteration: "current" };
    }
    return { ok: false, reason: "Backlog stories can only be scheduled or started" };
  }

  // State column -> state column: the DB permits any -> any state within
  // the project (spec/screens.md "Board layout: Kanban view" — "Drag = set
  // state ... ordering discipline lives in the UI advance button, not in
  // the drop"). Only a nonexistent target column and the estimation gate
  // block a drop here; the advance button (computeStateGate) is the only
  // place that enforces the one-step/accept-reject/restart ordering.
  if (categoryOf(targetStateId, states) === null) {
    return { ok: false, reason: "Cannot move this story to that column" };
  }
  const blocked = estimationGate(targetStateId);
  if (blocked) return blocked;
  return { ok: true, state_id: targetStateId, iteration: "keep" };
}

// List view (see spec/screens.md "Board layout: List view") merges all
// current-iteration state columns into one "current" zone so state renders
// as a badge instead of a physical column — priority is a single position
// order spanning every state, matching Pivotal Tracker's backlog list.
export type ListZoneId = "current" | typeof BACKLOG_COLUMN_ID | typeof ICEBOX_COLUMN_ID;

export function zoneForStory(story: KanbanStory, currentIterationId: string | null): ListZoneId {
  if (story.state_id === null) {
    return ICEBOX_COLUMN_ID;
  }
  if (currentIterationId && story.iteration_id === currentIterationId) {
    return "current";
  }
  return BACKLOG_COLUMN_ID;
}

export type ListDropEvaluation =
  | { ok: true; state_id?: string | null; iteration: "current" | "none" | "keep" }
  | { ok: false; reason: string };

/**
 * Validates a List-view drop across zones. Unlike `evaluateDrop`, a
 * same-zone drop is always a plain reorder regardless of the individual
 * stories' states (the zone doesn't encode state) — only crossing a zone
 * boundary can change state/iteration, and only for `unstarted`-category
 * stories, mirroring the Icebox/Backlog/Unstarted rules in `evaluateDrop`.
 */
export function evaluateListDrop(
  story: KanbanStory,
  from: ListZoneId,
  to: ListZoneId,
  states: ReadonlyArray<GateState>,
): ListDropEvaluation {
  if (from === to) {
    return { ok: true, iteration: "keep" };
  }

  if (to === ICEBOX_COLUMN_ID) {
    // Checked on state alone, regardless of origin zone — a story stuck
    // mid-iteration with no iteration_id still shows up in the Backlog zone
    // (zoneForStory falls through to it whenever iteration_id doesn't
    // match current), so checking `from === BACKLOG_COLUMN_ID` alone would
    // demote it to the Icebox unconditionally, discarding its progress.
    if (categoryOf(story.state_id, states) === "unstarted") {
      return { ok: true, state_id: null, iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move to the icebox" };
  }

  if (to === BACKLOG_COLUMN_ID) {
    if (from === ICEBOX_COLUMN_ID) {
      const target = lowestUnstartedStateId(states);
      if (!target) return { ok: false, reason: "This project has no unstarted state to schedule into" };
      return { ok: true, state_id: target, iteration: "none" };
    }
    if (from === "current" && categoryOf(story.state_id, states) === "unstarted") {
      return { ok: true, iteration: "none" };
    }
    return { ok: false, reason: "Only unstarted stories can move back to the backlog" };
  }

  // to === "current"
  if (from === ICEBOX_COLUMN_ID) {
    const target = lowestUnstartedStateId(states);
    if (!target) return { ok: false, reason: "This project has no unstarted state to schedule into" };
    return { ok: true, state_id: target, iteration: "current" };
  }
  if (from === BACKLOG_COLUMN_ID) {
    return { ok: true, iteration: "current" };
  }
  return { ok: false, reason: "Cannot move this story to that zone" };
}

/**
 * Merges the current iteration's per-state-column buckets into one flat
 * list ordered by `position`, matching spec/screens.md "Board layout: List
 * view". Concatenating the buckets in an arbitrary object-key order instead
 * produces a state-bucketed order, wrongly rendering e.g. an in-progress
 * story below an unstarted one at a lower position.
 */
export function flattenCurrentZone<T extends { position: number }>(
  containers: Record<string, ReadonlyArray<T>>,
  states: ReadonlyArray<ProjectState>,
): T[] {
  const columnOrder = [...states].sort((a, b) => a.position - b.position).map((s) => s.id);
  return columnOrder.flatMap((column) => containers[column] ?? []).sort((a, b) => a.position - b.position);
}
