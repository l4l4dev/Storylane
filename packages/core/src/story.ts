export type StoryType = "feature" | "bug" | "chore" | "release";
export type StoryState =
  | "unscheduled" | "unstarted" | "planned" | "started" | "finished" | "delivered" | "accepted" | "rejected";
export type StoryList = "backlog" | "icebox";

/** Per-type transitions (core-model §1.2 rules 6-8). A release skips started, a chore finished, and
 *  neither is ever delivered or rejected. `accepted` re-opens to `unstarted` for every type. */
const TRANSITIONS: Record<StoryType, Partial<Record<StoryState, readonly StoryState[]>>> = {
  feature: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "started"],
    planned: ["unscheduled", "unstarted", "started"],
    started: ["unstarted", "finished"],
    finished: ["started", "delivered"],
    delivered: ["accepted", "rejected"],
    rejected: ["started"],
    accepted: ["unstarted"],
  },
  bug: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "started"],
    planned: ["unscheduled", "unstarted", "started"],
    started: ["unstarted", "finished"],
    finished: ["started", "delivered"],
    delivered: ["accepted", "rejected"],
    rejected: ["started"],
    accepted: ["unstarted"],
  },
  chore: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "started"],
    planned: ["unscheduled", "unstarted", "started"],
    started: ["unstarted", "accepted"],
    accepted: ["unstarted"],
  },
  release: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "finished"],
    planned: ["unscheduled", "unstarted", "finished"],
    finished: ["accepted"],
    accepted: ["unstarted"],
  },
};

const ALL_STATES: readonly StoryState[] = [
  "unscheduled", "unstarted", "planned", "started", "finished", "delivered", "accepted", "rejected",
];

export function statesFor(type: StoryType): readonly StoryState[] {
  const reachable = new Set<StoryState>(Object.keys(TRANSITIONS[type]) as StoryState[]);
  for (const targets of Object.values(TRANSITIONS[type])) for (const t of targets ?? []) reachable.add(t);
  return ALL_STATES.filter((s) => reachable.has(s));
}

export function isValidTransition(type: StoryType, from: StoryState, to: StoryState): boolean {
  return (TRANSITIONS[type][from] ?? []).includes(to);
}

export function isEstimable(type: StoryType, bugsAndChoresAreEstimatable: boolean): boolean {
  if (type === "feature") return true;
  if (type === "release") return false;
  return bugsAndChoresAreEstimatable;
}

const STARTED_OR_LATER: readonly StoryState[] = ["started", "finished", "delivered", "accepted", "rejected"];

export function estimationGateBlocks(input: {
  storyType: StoryType;
  estimate: number | null;
  targetState: StoryState;
  bugsAndChoresAreEstimatable: boolean;
}): boolean {
  if (input.estimate !== null) return false;
  if (!isEstimable(input.storyType, input.bugsAndChoresAreEstimatable)) return false;
  return STARTED_OR_LATER.includes(input.targetState);
}

/** unscheduled and the Icebox are the same fact (core-model §1.2 rule 2). */
export function listForState(state: StoryState): StoryList {
  return state === "unscheduled" ? "icebox" : "backlog";
}
