import { addDays, daysBetween, storyTypeUsesPoints } from "@storylane/core";

export type BurndownStory = {
  id: string;
  points: number | null;
  storyType: string;
  currentCategory: string | null;
  currentIterationId: string | null;
  createdAt: string;
};

export type BurndownLog = {
  story_id: string | null;
  action: string;
  created_at: string;
  payload: unknown;
};

export type BurndownPoint = { date: string; remaining: number; ideal: number };

/** A story's three chart-relevant attributes as of some instant. */
type Snapshot = { category: string | undefined; points: number; member: boolean };
type Patch = Partial<Snapshot>;
type Transition = {
  createdAt: string;
  from: Patch;
  to: Patch;
  /** Restores the chart's starting state but is never replayed forward. */
  rewindOnly?: boolean;
  /** Replayed on the chart's first day rather than on its own date. */
  atStart?: boolean;
};

export function buildBurndown(input: {
  startDate: string;
  endDate: string;
  idealEndDate?: string;
  targetPoints: number;
  iterationId: string;
  categoryByStateName: ReadonlyMap<string, string>;
  stories: ReadonlyArray<BurndownStory>;
  logs: ReadonlyArray<BurndownLog>;
}): { coverage: "full" | "partial" | "none"; points: BurndownPoint[] } {
  if (input.logs.length === 0 || input.endDate < input.startDate) {
    return { coverage: "none", points: [] };
  }

  const tracked = input.stories.filter((story) => storyTypeUsesPoints(story.storyType));
  const trackedIds = new Set(tracked.map((story) => story.id));
  // Category resolved at transition time (from_category/to_category) is
  // authoritative — a state's category is immutable per row, so this value
  // can never go stale. Older logs (pre-20260727120000) only have the state
  // NAME; those fall back to the CURRENT name->category map, which is wrong
  // if that name was later reused by a differently categorized state — an
  // accepted gap for pre-migration history only.
  const category = (atTransition: unknown, name: unknown) =>
    typeof atTransition === "string"
      ? atTransition
      : typeof name === "string"
        ? input.categoryByStateName.get(name)
        : undefined;
  const pointsOf = (value: unknown) => (typeof value === "number" ? value : 0);

  let stateChanges = 0;
  let usableStateChanges = 0;
  const transitionsByStory = new Map<string, Transition[]>();

  for (const log of input.logs) {
    if (log.story_id === null || !trackedIds.has(log.story_id)) continue;
    // Anything older than the chart is already baked into the story's current
    // values, which the rewind below starts from.
    if (log.created_at.slice(0, 10) < input.startDate) continue;
    const payload = (log.payload ?? {}) as Record<string, unknown>;
    let patches: Omit<Transition, "createdAt"> | null = null;

    switch (log.action) {
      case "story.state_changed": {
        stateChanges += 1;
        const from = category(payload.from_category, payload.from);
        const to = category(payload.to_category, payload.to);
        // An unresolvable category contributes no reconstructed signal, so it
        // is dropped from the replay entirely rather than seeding `undefined`.
        if (from === undefined || to === undefined) break;
        usableStateChanges += 1;
        patches = { from: { category: from }, to: { category: to } };
        break;
      }
      case "story.points_changed":
        patches = { from: { points: pointsOf(payload.from) }, to: { points: pointsOf(payload.to) } };
        break;
      // story.iteration_rolled_over: the pre-rename action name
      // (20260727120000, superseded by 20260727140000) — same payload shape,
      // read here so already-deployed rows keep contributing history.
      case "story.iteration_rolled_over":
      case "story.iteration_changed": {
        const left = payload.from_iteration_id === input.iterationId;
        const arrived = payload.to_iteration_id === input.iterationId;
        // A hop between two OTHER iterations says nothing about membership
        // here. Dropping those is what makes this replay order-independent:
        // one finalize_iteration call can reparent a story through several
        // iterations, and every row it writes carries that transaction's
        // now(), with a random uuid for a tiebreak — so the hops cannot be
        // put in causal order. At most one of them names this iteration on
        // each side, and those are all this chart needs.
        if (!left && !arrived) break;
        // story.iteration_rolled_over predates the marker but needs no guess:
        // finalize_iteration's explicit INSERT was the only writer of that
        // action name (20260727120000), so every such row is a rollover.
        //
        // Accepted gap: story.iteration_changed rows written between
        // 20260727140000 (which generalized the trigger) and this migration
        // carry no marker and are indistinguishable from a manual drag, so a
        // rollover in that window still replays on its own date. It costs a
        // cosmetic step in ~4 days of pre-migration history; inferring one
        // from iteration-to-iteration movement would bake a board-UI
        // assumption into the replay for no better reason.
        const rollover =
          log.action === "story.iteration_rolled_over" ||
          payload.rollover === "auto" ||
          payload.rollover === "manual";
        patches = {
          from: { member: left },
          to: { member: arrived },
          // A rollover OUT of this iteration is its closing bookkeeping, not a
          // membership change within it. A manual finish clamps end_date to
          // today and reparents in the same transaction, so the log lands ON
          // endDate — replaying it would drop every carried-over story to zero
          // on the final day and show the sprint as fully delivered. It is
          // still rewound: recovering a past iteration's membership is exactly
          // what this log is for.
          rewindOnly: rollover && left,
          // ...and a rollover INTO this iteration means the story was here from
          // day one. The log is stamped whenever finalize_iteration happened to
          // run — lazily, on the first page load after a quiet weekend — which
          // is bookkeeping, not the date the work entered the sprint. Without
          // this the chart would start at zero and step UP. A manual drag in is
          // NOT clamped: that one really did arrive on its own date.
          atStart: rollover && arrived,
        };
        break;
      }
    }

    if (patches === null) continue;
    const list = transitionsByStory.get(log.story_id) ?? [];
    list.push({ createdAt: log.created_at, ...patches });
    transitionsByStory.set(log.story_id, list);
  }

  // Gated on state changes alone even though points and membership can now be
  // reconstructed without them: with no category history to rewind, every
  // story keeps its CURRENT category for the whole chart, which is the same
  // "project today's values backwards" falsehood this replay exists to kill —
  // a story finished last week would read as done from day one. Declining the
  // chart is honest; a flat line built that way is not.
  if (usableStateChanges === 0) {
    return { coverage: "none", points: [] };
  }

  const snapshots = new Map<string, Snapshot>();
  const timeline: Array<{ createdAt: string; date: string; storyId: string; patch: Patch }> = [];

  for (const story of tracked) {
    const transitions = (transitionsByStory.get(story.id) ?? []).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const snapshot: Snapshot = {
      category: story.currentCategory ?? undefined,
      points: story.points ?? 0,
      member: story.currentIterationId === input.iterationId,
    };
    // Rewind to the chart's start: applying every `from` newest-first leaves
    // the earliest transition's `from` in place, which is the value as of
    // startDate. Deliberately NOT bounded by endDate — a re-estimation or a
    // reschedule made after a finalized iteration ended must still be rewound
    // back out of that iteration's history, which is the whole point of
    // reconstructing rather than projecting today's values backwards.
    for (let i = transitions.length - 1; i >= 0; i -= 1) Object.assign(snapshot, transitions[i].from);
    snapshots.set(story.id, snapshot);

    // The forward walk, unlike the rewind, stops at endDate: events after the
    // chart ends belong to a later chart.
    for (const transition of transitions) {
      if (transition.rewindOnly) continue;
      const date = transition.atStart ? input.startDate : transition.createdAt.slice(0, 10);
      if (date > input.endDate) continue;
      timeline.push({ createdAt: transition.createdAt, date, storyId: story.id, patch: transition.to });
    }
  }
  // By date first: a clamped arrival carries a later createdAt than the day it
  // is replayed on, and the drain below stops at the first future entry.
  timeline.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  const idealDays = Math.max(1, daysBetween(input.startDate, input.idealEndDate ?? input.endDate));
  const points: BurndownPoint[] = [];
  let eventIndex = 0;

  for (let date = input.startDate, day = 0; date <= input.endDate; date = addDays(date, 1), day += 1) {
    while (eventIndex < timeline.length && timeline[eventIndex].date <= date) {
      const event = timeline[eventIndex];
      Object.assign(snapshots.get(event.storyId) as Snapshot, event.patch);
      eventIndex += 1;
    }
    // Recomputed in full each day rather than tracked as a running delta: a
    // story that is re-estimated while already done then needs no special
    // case, since a done story contributes zero whatever its points say.
    let remaining = 0;
    for (const story of tracked) {
      const snapshot = snapshots.get(story.id) as Snapshot;
      // A story cannot have been in the iteration before it existed, and its
      // creation writes no from/to transition to rewind — without this guard
      // a story added on day 5 would be counted from day 1.
      if (date < story.createdAt.slice(0, 10)) continue;
      if (!snapshot.member || snapshot.category === "done") continue;
      remaining += snapshot.points;
    }
    points.push({
      date,
      remaining: Math.max(0, remaining),
      ideal: Math.max(0, input.targetPoints * (1 - day / idealDays)),
    });
  }

  return { coverage: stateChanges === usableStateChanges ? "full" : "partial", points };
}
