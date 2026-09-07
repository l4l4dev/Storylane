import type { StateCategory } from "./story-state";
import type { StoryType } from "./story-types";

/** Points are chosen from the project's scale, never free numeric input (spec/features.md). */
export function isAllowedPointValue(points: number | null, allowed: readonly number[]): boolean {
  if (points === null) return true;
  return allowed.includes(points);
}

/**
 * spec/features.md "Estimation gate": an unestimated `feature` may only sit in the Icebox
 * (`targetCategory === null`) or an `unstarted`-category state. Other types are never gated —
 * chore/release carry no points at all, and a bug's points are optional.
 */
export function estimationGateBlocks(input: {
  storyType: StoryType;
  points: number | null;
  targetCategory: StateCategory | null;
}): boolean {
  if (input.storyType !== "feature" || input.points !== null) return false;
  return input.targetCategory !== null && input.targetCategory !== "unstarted";
}

/**
 * `completed_at` follows the target state's *category*, never its name: set when the story
 * enters a `done` state, preserved while it stays there, cleared whenever it leaves.
 */
export function nextCompletedAt(
  targetCategory: StateCategory | null,
  currentCompletedAt: number | null,
  now: number,
): number | null {
  if (targetCategory !== "done") return null;
  return currentCompletedAt ?? now;
}
