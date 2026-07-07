// Pure, framework-free helpers for the unified backlog + iterations board.

import { storyTypeUsesPoints } from "./stories";

// Container ids for the two non-iteration panels (see spec/screens.md
// "Board layout"). Iteration panels are keyed by their own `iterations.id`.
export const BACKLOG_CONTAINER_ID = "backlog";
export const ICEBOX_CONTAINER_ID = "icebox";

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

export type IceboxableStory = { state: string };

/** Splits off `unscheduled` (Icebox) stories from everything else — see spec/screens.md. */
export function partitionIcebox<T extends IceboxableStory>(
  stories: ReadonlyArray<T>,
): { icebox: T[]; rest: T[] } {
  const icebox: T[] = [];
  const rest: T[] = [];

  for (const story of stories) {
    (story.state === "unscheduled" ? icebox : rest).push(story);
  }

  return { icebox, rest };
}

export type PointedStory = { points: number | null; story_type: string };

/** Sum of points for point-bearing (feature/bug) stories, e.g. an iteration's total point count. */
export function sumPoints(stories: ReadonlyArray<PointedStory>): number {
  return stories
    .filter((story) => storyTypeUsesPoints(story.story_type))
    .reduce((total, story) => total + (story.points ?? 0), 0);
}

// Shared cross-container drag helpers — used by both the Kanban and List
// board views, whose containers are keyed differently (state columns vs.
// current/backlog/icebox zones) but behave identically during a drag.

/**
 * Finds which container currently holds `itemId` — either a container being
 * hovered directly (its droppable id equals itemId, relevant for empty
 * containers) or the container whose list contains it.
 */
export function findContainer<T extends { id: string }>(
  containers: Record<string, T[]>,
  itemId: string,
): string | undefined {
  if (itemId in containers) {
    return itemId;
  }
  return Object.keys(containers).find((key) => containers[key].some((item) => item.id === itemId));
}

/** Finds the item with `id` across every container, regardless of which one holds it. */
export function storyById<T extends { id: string }>(
  containers: Record<string, T[]>,
  id: string,
): T | undefined {
  for (const items of Object.values(containers)) {
    const match = items.find((item) => item.id === id);
    if (match) {
      return match;
    }
  }
  return undefined;
}
