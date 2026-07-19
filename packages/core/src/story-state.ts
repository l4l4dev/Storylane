// Pure, data-driven computation of the story lifecycle's one-click card
// buttons (advance / Accept-Reject pair / Restart). A project's states are
// arbitrary rows (project_states) grouped into fixed categories, so the
// button graph is derived from category + position instead of hardcoded
// state names. See spec/data-model.md "Transitions" (doc-8 §2) and
// spec/screens.md "Story card UX".
//
// The DB (set_story_state) permits any-to-any within the project; this
// module only decides what the UI OFFERS as a one-click button — ordering
// discipline lives here, not in the DB.

export const STATE_CATEGORIES = ["unstarted", "in_progress", "done", "rejected"] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

/** The subset of a project_states row the gate computation needs. */
export type GateState = {
  id: string;
  category: StateCategory;
  /** Nullable — a null action_label means this state offers no manual advance button. */
  actionLabel: string | null;
  position: number;
};

export type StateGate =
  | { kind: "none" }
  | { kind: "advance"; label: string; targetStateId: string }
  | { kind: "accept-reject"; acceptLabel: string; acceptStateId: string; rejectStateId: string | null }
  | { kind: "restart"; targetStateId: string | null };

/**
 * The one-click button (or pair) offered on a story currently in
 * `currentStateId` (null = Icebox — promotion out of the Icebox is
 * drag-and-drop only, never a button, so this always returns `none`).
 *
 * Rule, derived purely from `states` (sorted by position, the project's
 * single total order across all categories):
 * - on a `rejected`-category state: "Restart", targeting the
 *   lowest-position `in_progress`-category state (fixed UI vocabulary,
 *   never read from action_label — doc-8 §2 advisor).
 * - otherwise, look at the very next state by position:
 *   - if it's `done`-category: an Accept/Reject pair ("Reject" is likewise
 *     fixed vocabulary, targeting the lowest-position `rejected`-category
 *     state if one exists).
 *   - if it's `rejected`-category: no button. A `rejected`-category state
 *     is only ever a valid target via the synthesized Reject half of a
 *     pair above — nothing in project_states' schema forbids one being
 *     positioned outside that spot, and a plain advance button must never
 *     silently land a story in a rejected state under a label like "Finish".
 *   - otherwise: a single advance button to it.
 * - a null `actionLabel` on the current state means no button is shown
 *   (covers terminal `done` states, and lets a project owner suppress a
 *   button on any state deliberately).
 * - if a target category has no state in the project (e.g. a fully custom
 *   project deleted all `rejected` states, or all `in_progress` states),
 *   the corresponding target is null rather than pointing nowhere.
 * - ties in `position` (only ever transient — mid-reorder — since the
 *   column has no uniqueness constraint by design, see
 *   20260719000005_project_states.sql) break on `id` for a total order.
 */
export function computeStateGate(
  states: ReadonlyArray<GateState>,
  currentStateId: string | null,
): StateGate {
  if (currentStateId === null) {
    return { kind: "none" };
  }

  const sorted = [...states].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const currentIndex = sorted.findIndex((s) => s.id === currentStateId);
  if (currentIndex === -1) {
    return { kind: "none" };
  }
  const current = sorted[currentIndex];

  if (current.category === "rejected") {
    const target = sorted.find((s) => s.category === "in_progress");
    return { kind: "restart", targetStateId: target?.id ?? null };
  }

  const next = sorted[currentIndex + 1];
  if (!next || current.actionLabel === null || next.category === "rejected") {
    return { kind: "none" };
  }

  if (next.category === "done") {
    const rejectTarget = sorted.find((s) => s.category === "rejected");
    return {
      kind: "accept-reject",
      acceptLabel: current.actionLabel,
      acceptStateId: next.id,
      rejectStateId: rejectTarget?.id ?? null,
    };
  }

  return { kind: "advance", label: current.actionLabel, targetStateId: next.id };
}

/**
 * Whether entering `targetCategory` from no iteration must also assign the
 * current iteration — mirrors set_story_state's auto-assign rule
 * (20260719000007_set_story_state.sql). The drag path (dropStory/
 * dropStoryInList) already does this; a button path that only wrote
 * state_id would let clicking the advance button on a Backlog row produce a
 * story that's neither in the current iteration nor draggable back to
 * Backlog/Icebox (stuck).
 */
export function shouldAssignCurrentIteration(targetCategory: StateCategory, hasIterationId: boolean): boolean {
  return targetCategory === "in_progress" && !hasIterationId;
}
