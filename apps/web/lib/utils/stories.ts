// Pure, framework-free helpers for stories. Kept side-effect free so they can
// be unit-tested without a Supabase client or React.
//
// STORY_TYPES/StoryType/storyTypeUsesPoints/pointScaleValues live in
// @storylane/core (TASK-68), shared with the MCP server; re-exported here so
// this module's other importers are unaffected.
import { STORY_TYPES, storyTypeUsesPoints, pointScaleValues, type StateCategory, type StoryType } from "@storylane/core";
import type { ProjectState } from "@/lib/types";
export { STORY_TYPES, storyTypeUsesPoints, pointScaleValues, type StoryType };

export const STORY_TYPE_META: Record<StoryType, { label: string; className: string }> = {
  feature: { label: "Feature", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  bug: { label: "Bug", className: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
  chore: { label: "Chore", className: "bg-muted text-muted-foreground" },
  release: { label: "Release", className: "bg-primary/15 text-primary" },
};

const ICEBOX_CLASS_NAME = "bg-muted text-muted-foreground";

// A project's states are arbitrary per-category (TASK-91) — color can't be
// hardcoded per state NAME the way the old fixed 6-state map did. Instead
// each category gets a small palette, cycled by the state's position among
// its own category's states, so a project with N states per category still
// gets N visually distinct badges. This exactly reproduces the classic
// template's original per-state colors (Unstarted=muted, Started=blue,
// Finished=purple, Delivered=cyan, Accepted=green, Rejected=rose) as the
// category-0/1/2 cycle, and degrades gracefully for a custom project with
// more states per category than the palette has colors.
const CATEGORY_PALETTES: Record<StateCategory, string[]> = {
  unstarted: [ICEBOX_CLASS_NAME],
  in_progress: [
    "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  ],
  done: ["bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"],
  rejected: ["bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"],
};

/**
 * A state's 0-based rank among its own category's states, ordered by
 * position — the shared cycle index every category-driven palette (this
 * module's badge colors, kanban-columns-board.tsx's column tints/icons) uses
 * so a given state renders the same "hue slot" everywhere, keeping badges
 * and columns visually in sync (they always were, back when both were keyed
 * by the same literal state name).
 */
export function categoryRank(stateId: string, states: ReadonlyArray<Pick<ProjectState, "id" | "category" | "position">>): number {
  const state = states.find((s) => s.id === stateId);
  if (!state) return 0;
  const sameCategory = states.filter((s) => s.category === state.category).sort((a, b) => a.position - b.position);
  return Math.max(0, sameCategory.findIndex((s) => s.id === stateId));
}

/** A story's state badge: its name (or "Icebox" for `state_id === null`) and a category-derived color. */
export function storyStateBadge(
  stateId: string | null,
  states: ReadonlyArray<ProjectState>,
): { label: string; className: string } {
  if (stateId === null) {
    return { label: "Icebox", className: ICEBOX_CLASS_NAME };
  }
  const state = states.find((s) => s.id === stateId);
  if (!state) {
    return { label: "Unknown", className: ICEBOX_CLASS_NAME };
  }
  const index = categoryRank(stateId, states);
  const palette = CATEGORY_PALETTES[state.category];
  return { label: state.name, className: palette[index % palette.length] };
}

/**
 * An unestimated `feature` cannot be started (see spec/features.md).
 * Other types don't use points, so they are never blocked by this rule.
 */
export function isUnestimatedFeature(type: string, points: number | null): boolean {
  return type === "feature" && points === null;
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
