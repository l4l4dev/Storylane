// Pure, framework-free story-type helpers shared by web and mcp. Split out
// of apps/web/lib/utils/stories.ts (TASK-68) — everything here has no UI
// dependency (className metadata, filtering, point formatting stay in web).

export const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

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
