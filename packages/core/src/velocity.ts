// Pure, framework-free helpers for velocity. See spec/velocity.md.

import { storyTypeUsesPoints } from "./story-types";
import type { StateCategory } from "./story-state";

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

/**
 * Clamps a submitted velocity_window to what `projects_velocity_window_check`
 * (>= 1, supabase/migrations/20260714000001_velocity_window_check.sql)
 * allows, so createProject/updateProject never send an out-of-range value —
 * a 0 or negative window would otherwise make calculateVelocity's slice
 * permanently empty (velocity always reporting 0).
 */
export function clampVelocityWindow(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

// Matches finalize_iteration's SQL (20260719000010_reanchor_finalize_iteration.sql: `ps.category = 'done'`).
export type PointedStory = { story_type: string; state_category: StateCategory | null; points: number | null };

/**
 * Sum of points for done-category, point-bearing stories (feature/bug).
 * This is the value finalized onto `iterations.velocity` when an iteration
 * is marked done.
 */
export function acceptedPoints(stories: ReadonlyArray<PointedStory>): number {
  return stories
    .filter((story) => story.state_category === "done" && storyTypeUsesPoints(story.story_type))
    .reduce((total, story) => total + (story.points ?? 0), 0);
}
