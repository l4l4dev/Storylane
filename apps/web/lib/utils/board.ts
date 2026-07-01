// Pure, framework-free helpers for the unified backlog + iterations board.

import { storyTypeUsesPoints } from "./stories";

export type GroupableStory = { iteration_id: string | null };

/** Buckets stories by iteration, separating out the ones still sitting in the backlog. */
export function groupStoriesByIteration<T extends GroupableStory>(
  stories: ReadonlyArray<T>,
): { byIteration: Map<string, T[]>; backlog: T[] } {
  const byIteration = new Map<string, T[]>();
  const backlog: T[] = [];

  for (const story of stories) {
    if (story.iteration_id) {
      const bucket = byIteration.get(story.iteration_id) ?? [];
      bucket.push(story);
      byIteration.set(story.iteration_id, bucket);
    } else {
      backlog.push(story);
    }
  }

  return { byIteration, backlog };
}

export type PointedStory = { points: number | null; story_type: string };

/** Sum of points for point-bearing (feature/bug) stories, e.g. an iteration's total point count. */
export function sumPoints(stories: ReadonlyArray<PointedStory>): number {
  return stories
    .filter((story) => storyTypeUsesPoints(story.story_type))
    .reduce((total, story) => total + (story.points ?? 0), 0);
}
