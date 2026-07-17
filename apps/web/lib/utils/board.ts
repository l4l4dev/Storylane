// Pure, framework-free helpers for the unified backlog + iterations board —
// imported by Server Components (board/page.tsx, iterations/page.tsx) as well
// as client board views, so nothing here may pull in a browser-only
// dependency (see board-dnd.ts for the one helper that needs @dnd-kit).

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

/**
 * Whether a free-mode column's card count has passed its WIP limit
 * (spec/screens.md "Free mode board") — a soft limit, purely a display
 * warning; `null` means no limit is set.
 */
export function isOverWipLimit(count: number, wipLimit: number | null): boolean {
  return wipLimit != null && count > wipLimit;
}

// When a free-mode board has swimlanes, each board cell is a
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

/** Moves an item between two drag containers, preserving the hovered insertion behavior. */
export function moveBetweenContainers<T extends { id: string }>(
  containers: Record<string, T[]>,
  activeId: string,
  overContainer: string,
  overId: string,
  isAllowed: (activeId: string, overContainer: string) => boolean,
): Record<string, T[]> {
  const activeContainer = findContainer(containers, activeId);
  if (!activeContainer || activeContainer === overContainer || !isAllowed(activeId, overContainer)) {
    return containers;
  }

  const activeItems = containers[activeContainer] ?? [];
  const overItems = containers[overContainer] ?? [];
  const moved = activeItems.find((item) => item.id === activeId);
  if (!moved) {
    return containers;
  }
  const overIndex = overItems.findIndex((item) => item.id === overId);
  const insertAt = overIndex >= 0 ? overIndex : overItems.length;

  return {
    ...containers,
    [activeContainer]: activeItems.filter((item) => item.id !== activeId),
    [overContainer]: [...overItems.slice(0, insertAt), moved, ...overItems.slice(insertAt)],
  };
}

/**
 * The "before" anchor for the intent-based board move RPC (move_story_board,
 * TASK-56): given a container's post-move order and the moved item's id,
 * returns `"<kind>:<id>"` for the item the moved one now sits directly before,
 * or null when it landed last (append). Replaces sending the whole ordered_ids
 * sequence — the server re-derives dense positions from the current DB order,
 * so only this single neighbour is needed to place the moved item. `kind`
 * defaults to "story" for the Kanban/Free/Focus views whose items are all
 * stories; the List view's items carry their own story/divider kind.
 */
export function beforeAnchorId<T extends { id: string; kind?: string }>(
  reordered: ReadonlyArray<T>,
  movedId: string,
): string | null {
  const index = reordered.findIndex((item) => item.id === movedId);
  if (index < 0 || index === reordered.length - 1) {
    return null;
  }
  const next = reordered[index + 1];
  return `${next.kind ?? "story"}:${next.id}`;
}

