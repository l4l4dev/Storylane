// Pure, framework-free helpers for the state-based kanban board (see
// spec/screens.md "Board layout"): column assignment and drag-drop
// validation. Shared by the client board (to block invalid drops visually)
// and the `dropStory` server action (which never trusts the client).

import { isUnestimatedFeature } from "./stories";
import { computeStateGate, type GateState, type StateCategory } from "@storylane/core";
import type { ProjectState } from "@/lib/types";

export const BACKLOG_COLUMN_ID = "backlog";
export const ICEBOX_COLUMN_ID = "icebox";

// A container's nested Icebox children (doc-18 §9) get their own dnd-kit
// drag container in the List view, keyed off the container's story id — kept
// separate from ListZoneId (below), which stays a closed 3-value union since
// a container is off the board and never in a zone (spec/data-model.md).
const EPIC_ICEBOX_PREFIX = "epic:";
export function epicIceboxZoneId(containerId: string): string {
  return `${EPIC_ICEBOX_PREFIX}${containerId}`;
}
export function isEpicIceboxZone(zoneId: string): boolean {
  return zoneId.startsWith(EPIC_ICEBOX_PREFIX);
}

// The container ("epic") rows render as their own block above the flat Icebox
// list, so they need their own dnd-kit zone to be reorderable — but they are
// NOT a separate position space: like every state-null row they live in the one
// shared Icebox sequence (spec/data-model.md, doc-18 §2), which is why
// toServerZone maps this straight back to the plain Icebox zone.
export const CONTAINER_ROWS_ZONE_ID = "container-rows";

/**
 * The container block is exclusive in both directions: a container row only
 * ever reorders among other containers (it is off the board and has nowhere
 * else to be, doc-18 §4), and no ordinary story may be dropped into it.
 */
export function isDisallowedContainerRowDrop(isContainerRow: boolean, targetZone: string): boolean {
  return isContainerRow !== (targetZone === CONTAINER_ROWS_ZONE_ID);
}

/**
 * Whether a dnd-kit droppable id belongs to the container block — the block
 * itself or one of the container rows inside it.
 *
 * Needed because an expanded container row's droppable rect ENCLOSES that
 * epic's nest droppable and every nested child row, and closestCenter ranks
 * purely by centre distance with no notion of nesting: past one child the
 * enclosing row's centre sits among the children's and wins at random pixels,
 * hijacking a nest drop (and, the other way, a container dragged over another
 * expanded epic resolves to that epic's nest). Both drops are already
 * forbidden by isDisallowedContainerRowDrop; the caller applies the same rule
 * at collision time so the pointer can only ever resolve to a zone the drop
 * could actually land in. Why not a nesting-aware collision algorithm: the
 * block is exclusive both ways, so there is no legal cross-boundary drop for
 * one to disambiguate.
 */
export function isContainerBlockDroppable(droppableId: string, containerRowIds: ReadonlySet<string>): boolean {
  return droppableId === CONTAINER_ROWS_ZONE_ID || containerRowIds.has(droppableId);
}

/** The container id inside an epic-nest zone key, or null for any other zone. */
export function epicIdFromZone(zoneId: string): string | null {
  return isEpicIceboxZone(zoneId) ? zoneId.slice(EPIC_ICEBOX_PREFIX.length) : null;
}

/** What a List drop means when a container's Icebox nest is on either side. */
export type NestDrop =
  /** No nest involved — the caller applies the ordinary zone rules. */
  | { kind: "none" }
  /** Within the story's own nest: position only, no parent write. */
  | { kind: "reorder" }
  /** Into a nest from outside every nest: writes parent_id (doc-18 §9). */
  | { kind: "attach"; parentId: string }
  | { kind: "rejected" };

/**
 * Classifies a drop from the story's OWN parent_id and the target zone —
 * deliberately not from the zone the drag started in. onDragOver relocates the
 * item optimistically, so anything derived from the live drag state reports
 * wherever the pointer has been, and a nested child routed up through Current
 * and back down would launder itself past these rules. parent_id comes from
 * the server row and no reorder touches it.
 *
 * Two shapes are rejected because both would leave parent_id saying something
 * the board doesn't show: a story that still HAS a parent landing in the flat
 * Icebox list (which renders parentless rows only, so the next server render
 * pulls it back into its epic — a silent self-revert), and a child moving
 * between two different containers. An attach still has to clear the ordinary
 * Icebox crossing rule, which stays with evaluateListDrop.
 */
export function classifyNestDrop(storyParentId: string | null, targetZone: string): NestDrop {
  const targetEpic = epicIdFromZone(targetZone);

  if (targetEpic === null) {
    return storyParentId !== null && targetZone === ICEBOX_COLUMN_ID ? { kind: "rejected" } : { kind: "none" };
  }
  if (storyParentId === targetEpic) {
    return { kind: "reorder" };
  }
  return storyParentId === null ? { kind: "attach", parentId: targetEpic } : { kind: "rejected" };
}

/**
 * dropStoryInList only understands the 3 canonical ListZoneId strings — a drop
 * inside a nest must never send the raw dnd-kit container key ("epic:<id>") as
 * target_zone, or the server casts it, fails to match
 * ICEBOX_COLUMN_ID/BACKLOG_COLUMN_ID, and falls through to its "current" branch
 * — actually scheduling the story instead of leaving it in place. A nest is
 * semantically Icebox for zone purposes; the parent it implies travels
 * separately, as classifyNestDrop's "attach" delta.
 */
export function toServerZone(dndContainerId: string): string {
  return isEpicIceboxZone(dndContainerId) || dndContainerId === CONTAINER_ROWS_ZONE_ID
    ? ICEBOX_COLUMN_ID
    : dndContainerId;
}

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
 * Shared by evaluateDrop/evaluateListDrop's Icebox-demotion branch: only an
 * unstarted-category story may move to the Icebox, checked on the story's
 * ACTUAL state (not its origin column/zone) — a story stuck mid-iteration
 * with no iteration_id still shows up in the Backlog column/zone
 * (columnForStory/zoneForStory fall through to it whenever iteration_id
 * doesn't match current), so checking the origin alone would demote it
 * unconditionally, silently discarding its in-progress state.
 */
function demoteToIcebox(story: KanbanStory, states: ReadonlyArray<GateState>): DropEvaluation {
  if (categoryOf(story.state_id, states) === "unstarted") {
    return { ok: true, state_id: null, iteration: "none" };
  }
  return { ok: false, reason: "Only unstarted stories can move to the icebox" };
}

/**
 * Shared by evaluateDrop/evaluateListDrop's return-to-Backlog branch. By the
 * time either caller reaches here, `from` is always the Icebox or a
 * current-iteration state column/zone (a same-column/zone drop already
 * short-circuited above) — scheduling out of the Icebox goes through the
 * project's lowest unstarted state, and unscheduling a state-column story
 * only ever applies to unstarted-category work.
 */
function returnToBacklog(
  story: KanbanStory,
  fromIcebox: boolean,
  states: ReadonlyArray<GateState>,
): DropEvaluation {
  if (fromIcebox) {
    const target = lowestUnstartedStateId(states);
    if (!target) return { ok: false, reason: "This project has no unstarted state to schedule into" };
    return { ok: true, state_id: target, iteration: "none" };
  }
  if (categoryOf(story.state_id, states) === "unstarted") {
    return { ok: true, iteration: "none" };
  }
  return { ok: false, reason: "Only unstarted stories can move back to the backlog" };
}

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
    return demoteToIcebox(story, states);
  }

  if (to === BACKLOG_COLUMN_ID) {
    return returnToBacklog(story, from === ICEBOX_COLUMN_ID, states);
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
    //
    // No UI gesture reaches this: the Kanban view has no Backlog column
    // (spec/screens.md "Board layout") and the List view routes through
    // `evaluateListDrop`. It runs only in `dropStory`'s server-side
    // re-validation, when the story was unscheduled by someone else after the
    // drag began — so the strictness is the conflict guard, not an ordering
    // rule, and loosening it would let a stale drag silently reschedule and
    // advance a story another user just moved back.
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
    return demoteToIcebox(story, states);
  }

  if (to === BACKLOG_COLUMN_ID) {
    return returnToBacklog(story, from === ICEBOX_COLUMN_ID, states);
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
 *
 * The final position sort assumes `position` is ONE iteration-wide sequence,
 * not per-column — guaranteed by move_story_board writing a single
 * iteration-scoped sequence for both views (TASK-111). Column-local positions
 * would interleave columns wrongly here; the migration is what keeps them out.
 */
export function flattenCurrentZone<T extends { position: number }>(
  containers: Record<string, ReadonlyArray<T>>,
  states: ReadonlyArray<ProjectState>,
): T[] {
  const columnOrder = [...states].sort((a, b) => a.position - b.position).map((s) => s.id);
  return columnOrder.flatMap((column) => containers[column] ?? []).sort((a, b) => a.position - b.position);
}
