// Pure, data-driven roll-up of a container (epic) story's progress from its
// children (doc-18 §5). A container never stores its own state/points — its
// progress is derived on read from the children, here, so Web and iOS agree
// (golden fixture: spec/fixtures/container-rollup.json). Display only: this is
// never fed into velocity (children count as terminal stories on their own).
//
// A child's `category` is its project_states category, or null for a child in
// the Icebox (state_id IS NULL). The headline never rolls to `rejected` — a
// rejected child is a bounce, not a terminal (spec/data-model.md
// `project_states`); its count still shows in the breakdown.

import type { StateCategory } from "./story-state";

/** A container child, reduced to what the roll-up needs. null category = Icebox. */
export type RollupChild = {
  category: StateCategory | null;
  points: number | null;
};

/** The container's aggregate board state. `icebox` = every child unscheduled. */
export type RollupHeadline = "unstarted" | "in_progress" | "done" | "icebox";

export type ContainerRollup = {
  headline: RollupHeadline;
  /** Sum of children's points (null child points count as 0). */
  points: number;
  /** Per-category child count for the progress bar; `icebox` = null-state children. */
  breakdown: Record<StateCategory | "icebox", number>;
};

/**
 * Roll a container's children up to a single headline + point sum +
 * breakdown, per doc-18 §5 (evaluated top-down, first match wins):
 * - all children `done` → done
 * - else any child done/in_progress/rejected (work started or finished, but
 *   not all done) → in_progress — covers the "3 done + 2 unstarted" partial
 *   case, which must read in_progress, never unstarted
 * - else (every child unstarted/Icebox): every child in Icebox → icebox;
 *   otherwise unstarted
 *
 * A childless input (not a real container per §4) reads as icebox/0 defensively.
 */
export function rollupContainer(children: ReadonlyArray<RollupChild>): ContainerRollup {
  const breakdown: Record<StateCategory | "icebox", number> = {
    unstarted: 0,
    in_progress: 0,
    done: 0,
    rejected: 0,
    icebox: 0,
  };
  let points = 0;
  for (const child of children) {
    points += child.points ?? 0;
    breakdown[child.category ?? "icebox"] += 1;
  }

  return { headline: headlineFor(children.length, breakdown), points, breakdown };
}

function headlineFor(total: number, breakdown: Record<StateCategory | "icebox", number>): RollupHeadline {
  if (total === 0) return "icebox";
  if (breakdown.done === total) return "done";
  // Not all done, but some work has started or finished.
  if (breakdown.done + breakdown.in_progress + breakdown.rejected > 0) return "in_progress";
  // Every remaining child is unstarted or Icebox (no work started/finished).
  if (breakdown.icebox === total) return "icebox";
  return "unstarted";
}
