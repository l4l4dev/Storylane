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
