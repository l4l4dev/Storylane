// Pure, framework-free helpers for stories. Kept side-effect free so they can
// be unit-tested without a Supabase client or React.

export const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export const STORY_STATES = [
  "unstarted",
  "started",
  "finished",
  "delivered",
  "accepted",
  "rejected",
] as const;
export type StoryState = (typeof STORY_STATES)[number];

export const STORY_TYPE_META: Record<StoryType, { label: string; className: string }> = {
  feature: { label: "Feature", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  bug: { label: "Bug", className: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
  chore: { label: "Chore", className: "bg-muted text-muted-foreground" },
  release: { label: "Release", className: "bg-primary/15 text-primary" },
};

export const STORY_STATE_META: Record<StoryState, { label: string; className: string }> = {
  unstarted: { label: "Unstarted", className: "bg-muted text-muted-foreground" },
  started: { label: "Started", className: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  finished: { label: "Finished", className: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300" },
  delivered: { label: "Delivered", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300" },
  accepted: { label: "Accepted", className: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" },
  rejected: { label: "Rejected", className: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

/**
 * Points only apply to `feature` and `bug` stories. `chore` and `release` are
 * excluded from point counts (see SPEC velocity logic), so their points stay null.
 */
export function storyTypeUsesPoints(type: string): boolean {
  return type === "feature" || type === "bug";
}

// Point scales (see spec/features.md "Story Management"): points are chosen
// from the project's scale, never free numeric input.
const POINT_SCALES: Record<string, readonly number[]> = {
  fibonacci: [0, 1, 2, 3, 5, 8, 13],
  linear: [0, 1, 2, 3],
};

/**
 * Resolves a project's selectable point values from its `point_scale` /
 * `custom_points` columns. Unknown scale names fall back to fibonacci (the
 * DB default) so a bad row can't leave the UI with no options.
 */
export function pointScaleValues(
  pointScale: string,
  customPoints: ReadonlyArray<number> | null | undefined,
): number[] {
  if (pointScale === "custom") {
    return [...(customPoints ?? [])];
  }
  return [...(POINT_SCALES[pointScale] ?? POINT_SCALES.fibonacci)];
}

/**
 * An unestimated `feature` cannot be started (see spec/features.md).
 * Other types don't use points, so they are never blocked by this rule.
 */
export function isUnestimatedFeature(type: string, points: number | null): boolean {
  return type === "feature" && points === null;
}

/** Position to append a new story at the bottom of the backlog. */
export function nextPosition(stories: ReadonlyArray<{ position: number }>): number {
  return stories.reduce((max, story) => Math.max(max, story.position), -1) + 1;
}

export type StoryFilter = {
  type?: string | null;
  assigneeId?: string | null;
  labelId?: string | null;
  epicId?: string | null;
};

type FilterableStory = {
  story_type: string;
  assignee_id: string | null;
  labelIds?: ReadonlyArray<string>;
  epic_id?: string | null;
};

/** Whether a single story matches type/assignee/label/epic criteria. Empty/undefined criteria match everything. */
export function matchesStoryFilter<T extends FilterableStory>(story: T, filter: StoryFilter): boolean {
  if (filter.type && story.story_type !== filter.type) {
    return false;
  }
  if (filter.assigneeId && story.assignee_id !== filter.assigneeId) {
    return false;
  }
  if (filter.labelId && !(story.labelIds ?? []).includes(filter.labelId)) {
    return false;
  }
  if (filter.epicId && story.epic_id !== filter.epicId) {
    return false;
  }
  return true;
}

/** Filters by story type, assignee, label, and epic. Empty/undefined criteria match everything. */
export function filterStories<T extends FilterableStory>(stories: ReadonlyArray<T>, filter: StoryFilter): T[] {
  return stories.filter((story) => matchesStoryFilter(story, filter));
}

/**
 * Formats a points value for card display (see spec/screens.md "Story card
 * UX"): 1-3 points render as dots (Pivotal Tracker convention), 0 or 4+
 * render as the numeral since a 0-dot estimate would be invisible.
 */
export function formatPoints(points: number): string {
  if (points > 0 && points <= 3) {
    return "•".repeat(points);
  }
  return String(points);
}

/**
 * Parses a points form value. Returns null for non-point story types or blank
 * input ("unestimated"). Values not in `allowedPoints` (the project's point
 * scale — see spec/features.md, no free numeric input) also parse to null so
 * a tampered or stale form value can't write an off-scale estimate.
 */
export function parsePoints(
  rawValue: string | null | undefined,
  type: string,
  allowedPoints: ReadonlyArray<number>,
): number | null {
  if (!storyTypeUsesPoints(type)) {
    return null;
  }
  const trimmed = (rawValue ?? "").trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  if (!allowedPoints.includes(parsed)) {
    return null;
  }
  return parsed;
}
