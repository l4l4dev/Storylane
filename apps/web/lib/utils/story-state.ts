// Pure state machine for the story lifecycle's one-click card buttons
// (Start / Finish / Deliver / Accept / Reject / Restart). See
// spec/screens.md "Story card UX": only the next valid transition(s) are
// offered, no free-form state jumps.
//
// The unscheduled -> unstarted move (Icebox -> Backlog) is drag-and-drop
// only, not a button (see spec/features.md Story Management), so it isn't
// modeled as an action here — `unscheduled` has no available actions.

export const STORY_STATES = [
  "unscheduled",
  "unstarted",
  "started",
  "finished",
  "delivered",
  "accepted",
  "rejected",
] as const;
export type StoryState = (typeof STORY_STATES)[number];

export const STORY_TRANSITION_ACTIONS = ["start", "finish", "deliver", "accept", "reject", "restart"] as const;
export type StoryTransitionAction = (typeof STORY_TRANSITION_ACTIONS)[number];

type Transition = { from: StoryState; to: StoryState; label: string };

const TRANSITIONS: Record<StoryTransitionAction, Transition> = {
  start: { from: "unstarted", to: "started", label: "Start" },
  finish: { from: "started", to: "finished", label: "Finish" },
  deliver: { from: "finished", to: "delivered", label: "Deliver" },
  accept: { from: "delivered", to: "accepted", label: "Accept" },
  reject: { from: "delivered", to: "rejected", label: "Reject" },
  restart: { from: "rejected", to: "started", label: "Restart" },
};

/** Actions offered as one-click buttons on a story card in its current state. */
export function availableTransitions(state: StoryState): StoryTransitionAction[] {
  return STORY_TRANSITION_ACTIONS.filter((action) => TRANSITIONS[action].from === state);
}

/** Whether `action` is a valid one-click transition from `state`. */
export function canTransition(state: StoryState, action: StoryTransitionAction): boolean {
  return TRANSITIONS[action].from === state;
}

/** Applies a transition action, throwing if it isn't valid from the given state. */
export function applyTransition(state: StoryState, action: StoryTransitionAction): StoryState {
  const transition = TRANSITIONS[action];
  if (transition.from !== state) {
    throw new Error(`Cannot "${action}" a story in state "${state}" (expected "${transition.from}")`);
  }
  return transition.to;
}

/** Button label for a transition action (e.g. "Start", "Restart"). */
export function transitionLabel(action: StoryTransitionAction): string {
  return TRANSITIONS[action].label;
}

/**
 * Whether a one-click transition button (Start/Restart, both targeting
 * "started") must also assign the current iteration (TASK-19). The drag
 * path (dropStory/dropStoryInList) already does this when scheduling a
 * backlog story into "started"; the button path used to write only
 * `state`, so clicking Start on a Backlog row (List view renders the
 * button on every row, including Backlog ones) produced
 * `state: "started", iteration_id: null` — a story that's neither in the
 * current iteration nor draggable back to Backlog/Icebox (stuck).
 */
export function shouldAssignCurrentIteration(nextState: StoryState, hasIterationId: boolean): boolean {
  return nextState === "started" && !hasIterationId;
}
