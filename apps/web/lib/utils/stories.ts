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

export const STORY_TYPE_META: Record<StoryType, { label: string; icon: string; className: string }> = {
  feature: { label: "Feature", icon: "★", className: "bg-amber-100 text-amber-800" },
  bug: { label: "Bug", icon: "🐞", className: "bg-red-100 text-red-800" },
  chore: { label: "Chore", icon: "⚙", className: "bg-gray-100 text-gray-700" },
  release: { label: "Release", icon: "🚩", className: "bg-indigo-100 text-indigo-800" },
};

export const STORY_STATE_META: Record<StoryState, { label: string; className: string }> = {
  unstarted: { label: "Unstarted", className: "bg-gray-100 text-gray-600" },
  started: { label: "Started", className: "bg-blue-100 text-blue-700" },
  finished: { label: "Finished", className: "bg-purple-100 text-purple-700" },
  delivered: { label: "Delivered", className: "bg-cyan-100 text-cyan-700" },
  accepted: { label: "Accepted", className: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", className: "bg-rose-100 text-rose-700" },
};

/**
 * Points only apply to `feature` and `bug` stories. `chore` and `release` are
 * excluded from point counts (see SPEC velocity logic), so their points stay null.
 */
export function storyTypeUsesPoints(type: string): boolean {
  return type === "feature" || type === "bug";
}

/** Position to append a new story at the bottom of the backlog. */
export function nextPosition(stories: ReadonlyArray<{ position: number }>): number {
  return stories.reduce((max, story) => Math.max(max, story.position), -1) + 1;
}

/** Maps an ordered list of ids to dense, zero-based positions. */
export function reorderPositions(orderedIds: ReadonlyArray<string>): { id: string; position: number }[] {
  return orderedIds.map((id, index) => ({ id, position: index }));
}

export type StoryFilter = {
  type?: string | null;
  assigneeId?: string | null;
  labelId?: string | null;
};

type FilterableStory = {
  story_type: string;
  assignee_id: string | null;
  labelIds?: ReadonlyArray<string>;
};

/** Filters by story type, assignee, and label. Empty/undefined criteria match everything. */
export function filterStories<T extends FilterableStory>(stories: ReadonlyArray<T>, filter: StoryFilter): T[] {
  return stories.filter((story) => {
    if (filter.type && story.story_type !== filter.type) {
      return false;
    }
    if (filter.assigneeId && story.assignee_id !== filter.assigneeId) {
      return false;
    }
    if (filter.labelId && !(story.labelIds ?? []).includes(filter.labelId)) {
      return false;
    }
    return true;
  });
}

/**
 * Parses a points form value. Returns null for non-point story types or blank
 * input, and clamps negatives to null so the DB CHECK (points >= 0) holds.
 */
export function parsePoints(rawValue: string | null | undefined, type: string): number | null {
  if (!storyTypeUsesPoints(type)) {
    return null;
  }
  const trimmed = (rawValue ?? "").trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}
