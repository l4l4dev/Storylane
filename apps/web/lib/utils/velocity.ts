// Pure, framework-free helpers for velocity. See spec/velocity.md.

import { storyTypeUsesPoints } from "./stories";

export type CompletedIteration = { velocity: number | null };

/**
 * Average finalized velocity across the most recent `velocityWindow`
 * completed iterations. `completedIterations` must already be sorted
 * most-recent-first (highest iteration number first).
 */
export function calculateVelocity(
  completedIterations: ReadonlyArray<CompletedIteration>,
  velocityWindow: number,
): number {
  const recent = completedIterations.slice(0, velocityWindow);
  if (recent.length === 0) {
    return 0;
  }
  const sum = recent.reduce((total, iteration) => total + (iteration.velocity ?? 0), 0);
  return Math.round(sum / recent.length);
}

export type PointedStory = { story_type: string; state: string; points: number | null };

/**
 * Sum of points for accepted, point-bearing stories (feature/bug). This is
 * the value finalized onto `iterations.velocity` when an iteration is marked done.
 */
export function acceptedPoints(stories: ReadonlyArray<PointedStory>): number {
  return stories
    .filter((story) => story.state === "accepted" && storyTypeUsesPoints(story.story_type))
    .reduce((total, story) => total + (story.points ?? 0), 0);
}
