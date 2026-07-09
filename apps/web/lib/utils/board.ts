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

/**
 * Whether a free-mode column's card count has passed its WIP limit
 * (TASK-16.2, spec/screens.md "Free mode board") — a soft limit, purely a
 * display warning; `null` means no limit is set.
 */
export function isOverWipLimit(count: number, wipLimit: number | null): boolean {
  return wipLimit != null && count > wipLimit;
}

// TASK-16.3: when a free-mode board has swimlanes, each board cell is a
// column x lane pair. `::` never appears in a UUID, so this composite key
// can't collide with a bare status id (the no-lanes container key) or a
// story id, letting findContainer/storyById below work unchanged.
const LANE_CONTAINER_SEPARATOR = "::";
const NO_LANE = "none";

/** Builds a composite board-cell container id for a (status, lane) pair — `laneId` null means the "No lane" band. */
export function laneContainerKey(statusId: string, laneId: string | null): string {
  return `${statusId}${LANE_CONTAINER_SEPARATOR}${laneId ?? NO_LANE}`;
}

/** Splits a composite board-cell container id back into its status and lane ids. */
export function parseLaneContainerKey(key: string): { statusId: string; laneId: string | null } {
  const [statusId, laneId] = key.split(LANE_CONTAINER_SEPARATOR);
  return { statusId, laneId: laneId === NO_LANE ? null : laneId };
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

/**
 * Moves the item `activeId` to sit where `overId` currently sits — the same
 * single-element relocation dnd-kit's own `arrayMove` performs (replicated
 * here to keep this module framework-free), exposed as a pure helper so
 * callers always run it against a container's *full*, unfiltered item list
 * (TASK-20). `activeId`/`overId` only ever come from currently-rendered
 * (visible) rows, but indexing into the full list still finds them
 * correctly, and relocating just the dragged item leaves every other item —
 * hidden by an active filter or not — in the same relative order, so no two
 * rows can ever collide on the dense position written afterwards.
 */
export function reorderContainer<T extends { id: string }>(
  items: ReadonlyArray<T>,
  activeId: string,
  overId: string,
): T[] {
  const oldIndex = items.findIndex((item) => item.id === activeId);
  const newIndex = items.findIndex((item) => item.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return [...items];
  }
  const result = items.slice();
  result.splice(newIndex, 0, result.splice(oldIndex, 1)[0]);
  return result;
}
