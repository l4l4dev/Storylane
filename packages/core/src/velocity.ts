// Pure, framework-free helpers for velocity. See spec/velocity.md.

export type CompletedIteration = { velocity: number | null; capacity: number | null; skipped?: boolean | null };

/**
 * Points per person-day over the most recent `velocityWindow` non-skipped,
 * capacity-bearing `done` iterations. `completedIterations` must already be
 * sorted most-recent-first (highest iteration number first).
 *
 * A ratio of sums, not an average of ratios (doc-8 §7): a one-day sprint
 * with a lucky 3-pointer must not outweigh a full one. The `capacity > 0`
 * filter both excludes iterations that carry no real capacity — NULL from
 * before the snapshot existed, 0 from the catch-up loop's gap rows — and
 * makes the division safe.
 *
 * The numerator sums the *snapshotted* `velocity` values, never a fresh
 * aggregation over `stories`: re-aggregating would let editing a finished
 * story's points move history.
 */
export function velocityRate(
  completedIterations: ReadonlyArray<CompletedIteration>,
  velocityWindow: number,
): number {
  const window = completedIterations
    .filter((iteration) => !iteration.skipped && (iteration.capacity ?? 0) > 0)
    .slice(0, velocityWindow);
  if (window.length === 0) {
    return 0;
  }
  const points = window.reduce((total, iteration) => total + (iteration.velocity ?? 0), 0);
  const capacity = window.reduce((total, iteration) => total + (iteration.capacity ?? 0), 0);
  return points / capacity;
}

/**
 * Point budget for a future sprint of `plannedCapacity` person-days. The
 * minimum of 1 keeps backlog splitting progressing before any capacity
 * history exists (spec/velocity.md "Virtual-group computation") — without
 * it a fresh project's groups would each hold a single story forever.
 */
export function forecastPoints(rate: number, plannedCapacity: number): number {
  return Math.max(rate * plannedCapacity, 1);
}

/**
 * Clamps a submitted velocity_window to what `projects_velocity_window_check`
 * (>= 1, supabase/migrations/20260714000001_velocity_window_check.sql)
 * allows, so createProject/updateProject never send an out-of-range value —
 * a 0 or negative window would otherwise make velocityRate's slice
 * permanently empty (velocity always reporting 0).
 */
export function clampVelocityWindow(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Clamps a submitted iteration_length to what `projects_iteration_length_range`
 * (1-90, supabase/migrations/20260720000006_flexible_cadence.sql) allows, so
 * createProject/updateProject never send a value the CHECK rejects — neither
 * action has an error channel to report the rejection through. A length below
 * 1 would also make finalize_iteration's `end = start + (length - 1)` run
 * backwards and generate rows without ever reaching today.
 */
export function clampIterationLength(value: number): number {
  if (!Number.isFinite(value)) {
    return 14;
  }
  return Math.min(90, Math.max(1, Math.floor(value)));
}
