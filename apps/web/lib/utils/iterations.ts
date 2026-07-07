// Pure, framework-free helpers for iterations. See spec/velocity.md.
// Dates are handled as plain "YYYY-MM-DD" strings (matching the DB `date`
// type) to avoid local-timezone drift when comparing against "today".

import { storyTypeUsesPoints } from "./stories";

const MS_PER_DAY = 86_400_000;

function parseDateOnly(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** One past the highest existing sprint number, or 1 if there are none yet. */
export function nextIterationNumber(iterations: ReadonlyArray<{ number: number }>): number {
  return iterations.reduce((max, iteration) => Math.max(max, iteration.number), 0) + 1;
}

/**
 * The next iteration starts the day after the latest existing iteration ends;
 * the very first iteration for a project starts today.
 */
export function nextIterationDates(
  iterations: ReadonlyArray<{ end_date: string }>,
  iterationLengthDays: number,
  today: string,
): { start_date: string; end_date: string } {
  const latestEndMs = iterations.reduce<number | null>((latest, iteration) => {
    const end = parseDateOnly(iteration.end_date);
    return latest === null || end > latest ? end : latest;
  }, null);

  const startMs = latestEndMs === null ? parseDateOnly(today) : latestEndMs + MS_PER_DAY;
  const endMs = startMs + (iterationLengthDays - 1) * MS_PER_DAY;

  return { start_date: formatDateOnly(startMs), end_date: formatDateOnly(endMs) };
}

/** An iteration is "current" when today falls within its date range and it hasn't been finalized. */
export function isCurrentIteration(
  iteration: { start_date: string; end_date: string; state: string },
  today: string,
): boolean {
  return iteration.state !== "done" && iteration.start_date <= today && today <= iteration.end_date;
}

/** Done iterations are frozen: no drag, no goal edits, no manual story moves. */
export function isIterationEditable(iteration: { state: string }): boolean {
  return iteration.state !== "done";
}

export type BacklogStoryForAssignment = {
  id: string;
  points: number | null;
  story_type: string;
};

/**
 * Pulls stories from the top of the backlog (already ordered by position) to
 * fill the next iteration up to `velocity` points. Non-pointable stories
 * (chore/release) don't count against the budget but are still pulled in if
 * encountered before the cutoff; the first story is always included even if
 * it alone exceeds the budget.
 */
export function autoAssignStoryIds(
  backlog: ReadonlyArray<BacklogStoryForAssignment>,
  velocity: number,
): string[] {
  const assigned: string[] = [];
  let sum = 0;
  for (const story of backlog) {
    if (sum >= velocity) {
      break;
    }
    assigned.push(story.id);
    if (storyTypeUsesPoints(story.story_type)) {
      sum += story.points ?? 0;
    }
  }
  return assigned;
}

export type BacklogStoryForMarkers = { points: number | null; story_type: string };

/**
 * Segments the backlog (already ordered by position) into the virtual future
 * iterations drawn as boundary markers in the Backlog panel (see
 * spec/velocity.md "Marker computation"). Each group's points stay at or
 * under `max(velocity, 1)`; chore/release/unestimated stories consume 0 points
 * and never trigger a break by themselves. A single story bigger than the
 * whole capacity still gets its own group.
 */
export function splitBacklogIntoVirtualIterations<T extends BacklogStoryForMarkers>(
  backlog: ReadonlyArray<T>,
  velocity: number,
): T[][] {
  const capacity = Math.max(velocity, 1);
  const groups: T[][] = [];
  let current: T[] = [];
  let sum = 0;

  for (const story of backlog) {
    const cost = storyTypeUsesPoints(story.story_type) ? story.points ?? 0 : 0;
    if (current.length > 0 && sum + cost > capacity) {
      groups.push(current);
      current = [];
      sum = 0;
    }
    current.push(story);
    sum += cost;
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

// Two kinds of freeform backlog row (Task 15 follow-up: `backlog_dividers`).
// `note` is purely cosmetic. `iteration_break` forces a velocity-group
// boundary at that exact point — an escape hatch on top of the automatic,
// capacity-based split below, for when the PO wants "iteration 2 ends here"
// regardless of remaining points.
export type BacklogDivider = { id: string; label: string; kind: "note" | "iteration_break" };

export type BacklogRowItem<T> = { kind: "story"; story: T } | { kind: "divider"; divider: BacklogDivider };

export type BacklogRow<T> =
  | { kind: "story"; story: T }
  | { kind: "note"; divider: BacklogDivider }
  // `divider` is set only for a manually-placed break (so the UI can offer
  // to delete it) — absent for an automatic, capacity-triggered one.
  | { kind: "iteration-marker"; number: number; points: number; divider?: BacklogDivider };

/**
 * Interleaves the backlog's stories and freeform rows (Task 15 follow-up)
 * into one render-ready row sequence. Walks the list accumulating points
 * per virtual iteration exactly like `splitBacklogIntoVirtualIterations`,
 * but a `note` passes through untouched (no effect on the count) and an
 * `iteration_break` unconditionally closes the current group, whether or
 * not the automatic capacity would have triggered a split there.
 */
export function buildBacklogRows<T extends BacklogStoryForMarkers & { id: string }>(
  items: ReadonlyArray<BacklogRowItem<T>>,
  velocity: number,
  startingIterationNumber: number,
): BacklogRow<T>[] {
  const capacity = Math.max(velocity, 1);
  const rows: BacklogRow<T>[] = [];
  let groupIndex = 0;
  let sum = 0;
  let groupHasItem = false;

  function closeGroup(divider?: BacklogDivider) {
    groupIndex += 1;
    rows.push({ kind: "iteration-marker", number: startingIterationNumber + groupIndex, points: sum, divider });
    sum = 0;
    groupHasItem = false;
  }

  for (const item of items) {
    if (item.kind === "divider") {
      if (item.divider.kind === "note") {
        rows.push({ kind: "note", divider: item.divider });
      } else {
        closeGroup(item.divider);
      }
      continue;
    }

    const cost = storyTypeUsesPoints(item.story.story_type) ? item.story.points ?? 0 : 0;
    if (groupHasItem && sum + cost > capacity) {
      closeGroup();
    }
    rows.push({ kind: "story", story: item.story });
    sum += cost;
    groupHasItem = true;
  }

  return rows;
}
