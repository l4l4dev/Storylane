// Pure, framework-free helpers for iterations. See spec/velocity.md.
// Dates are handled as plain "YYYY-MM-DD" strings (matching the DB `date`
// type) to avoid local-timezone drift when comparing against "today".

import { storyTypeUsesPoints } from "./stories";

const MS_PER_DAY = 86_400_000;

function parseDateOnly(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Done iterations are frozen: no drag, no goal edits, no manual story moves. */
export function isIterationEditable(iteration: { state: string }): boolean {
  return iteration.state !== "done";
}

export type BacklogStoryForAssignment = {
  id: string;
  points: number | null;
  story_type: string;
};

/**
 * Pulls stories from the top of the backlog (already ordered by position) to
 * fill the next iteration up to `velocity` points. Non-pointable stories
 * (chore/release) don't count against the budget but are still pulled in if
 * encountered before the cutoff; the first story is always included even if
 * it alone exceeds the budget.
 */
export function autoAssignStoryIds(
  backlog: ReadonlyArray<BacklogStoryForAssignment>,
  velocity: number,
): string[] {
  const assigned: string[] = [];
  let sum = 0;
  for (const story of backlog) {
    if (sum >= velocity) {
      break;
    }
    assigned.push(story.id);
    if (storyTypeUsesPoints(story.story_type)) {
      sum += story.points ?? 0;
    }
  }
  return assigned;
}

export type BacklogStoryForMarkers = { points: number | null; story_type: string };

/**
 * Segments the backlog (already ordered by position) into the virtual future
 * iterations drawn as boundary markers in the Backlog panel (see
 * spec/velocity.md "Marker computation"). Each group's points stay at or
 * under `max(velocity, 1)`; chore/release/unestimated stories consume 0 points
 * and never trigger a break by themselves. A single story bigger than the
 * whole capacity still gets its own group.
 */
export function splitBacklogIntoVirtualIterations<T extends BacklogStoryForMarkers>(
  backlog: ReadonlyArray<T>,
  velocity: number,
): T[][] {
  const capacity = Math.max(velocity, 1);
  const groups: T[][] = [];
  let current: T[] = [];
  let sum = 0;

  for (const story of backlog) {
    const cost = storyTypeUsesPoints(story.story_type) ? story.points ?? 0 : 0;
    if (current.length > 0 && sum + cost > capacity) {
      groups.push(current);
      current = [];
      sum = 0;
    }
    current.push(story);
    sum += cost;
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

// Two kinds of freeform backlog row (`backlog_dividers`).
// `note` is purely cosmetic. `iteration_break` forces a velocity-group
// boundary at that exact point — an escape hatch on top of the automatic,
// capacity-based split below, for when the PO wants "iteration 2 ends here"
// regardless of remaining points.
export type BacklogDivider = { id: string; label: string; kind: "note" | "iteration_break" };

export type BacklogRowItem<T> = { kind: "story"; story: T } | { kind: "divider"; divider: BacklogDivider };

export type BacklogRow<T> =
  | { kind: "story"; story: T }
  | { kind: "note"; divider: BacklogDivider }
  // Auto-generated, always precedes its group's rows — never draggable.
  // `manualBreakDividerId` is set when this group's boundary was forced by
  // a manual iteration break rather than capacity alone (TASK-43) — the
  // break itself has no row of its own (see the `iteration-break` case
  // below); the UI's only remaining affordance for it is a small removable
  // badge on this header, keyed by this id.
  | { kind: "iteration-header"; number: number; points: number; manualBreakDividerId?: string }
  // The manually-placed break itself — a real `backlog_dividers` row, kept
  // here only as an insertion anchor (`nextRealRowId`) for the hover
  // insert-between affordance. Never rendered as its own row (TASK-43) —
  // the `iteration-header` segment it closes carries `manualBreakDividerId`
  // instead. Carries no number: the header that follows it already shows
  // the group it opens.
  | { kind: "iteration-break"; divider: BacklogDivider };

/**
 * Interleaves the backlog's stories and freeform rows into one
 * render-ready row sequence, with every virtual-iteration group headed by
 * its own numbered header row (spec/screens.md "Backlog groups") —
 * starting at `startingIterationNumber`, even for a lone group that never
 * splits. Heading every group up front, rather than only once a *later*
 * story crosses into the next one, is what keeps the very first group —
 * and a final group with nothing after it — from rendering with no label
 * at all.
 *
 * Two passes: first walk the items exactly like
 * `splitBacklogIntoVirtualIterations` — a `note` joins whichever group it
 * currently falls in without affecting the point count, an
 * `iteration_break` unconditionally closes the current group — but buffer
 * each group's rows instead of emitting them immediately, since the
 * header needs the group's total *before* its first row. Then flatten,
 * assigning sequential numbers only to groups (a break's own row carries
 * none).
 */
export function buildBacklogRows<T extends BacklogStoryForMarkers & { id: string }>(
  items: ReadonlyArray<BacklogRowItem<T>>,
  velocity: number,
  startingIterationNumber: number,
): BacklogRow<T>[] {
  const capacity = Math.max(velocity, 1);

  type Segment =
    | { kind: "group"; rows: BacklogRow<T>[]; points: number }
    | { kind: "break"; divider: BacklogDivider };

  const segments: Segment[] = [];
  let groupRows: BacklogRow<T>[] = [];
  let sum = 0;
  let groupHasItem = false;

  function closeGroup() {
    segments.push({ kind: "group", rows: groupRows, points: sum });
    groupRows = [];
    sum = 0;
    groupHasItem = false;
  }

  for (const item of items) {
    if (item.kind === "divider") {
      if (item.divider.kind === "note") {
        groupRows.push({ kind: "note", divider: item.divider });
      } else {
        closeGroup();
        segments.push({ kind: "break", divider: item.divider });
      }
      continue;
    }

    const cost = storyTypeUsesPoints(item.story.story_type) ? item.story.points ?? 0 : 0;
    if (groupHasItem && sum + cost > capacity) {
      closeGroup();
    }
    groupRows.push({ kind: "story", story: item.story });
    sum += cost;
    groupHasItem = true;
  }
  // Flush the trailing group whenever it has content, or when a manual
  // break is the very last item — otherwise the group it opens (empty or
  // not) would render with no header, asymmetric with a *leading* break
  // (which already gets an empty header before it).
  if (groupRows.length > 0 || segments[segments.length - 1]?.kind === "break") {
    closeGroup();
  }

  const rows: BacklogRow<T>[] = [];
  let number = startingIterationNumber - 1;
  // The most recent break segment's divider id, attached to the very next
  // group's header (TASK-43) then cleared — a break always precedes
  // exactly the one group it closed into, never a later, unrelated one.
  let pendingBreakDividerId: string | undefined;
  for (const segment of segments) {
    if (segment.kind === "group") {
      number += 1;
      rows.push({ kind: "iteration-header", number, points: segment.points, manualBreakDividerId: pendingBreakDividerId });
      pendingBreakDividerId = undefined;
      rows.push(...segment.rows);
    } else {
      rows.push({ kind: "iteration-break", divider: segment.divider });
      pendingBreakDividerId = segment.divider.id;
    }
  }
  return rows;
}

/**
 * Projected date range for a virtual (not-yet-real) iteration, shown on its
 * Backlog group header (spec/screens.md "Backlog groups"). `offset` is
 * 1-based: 1 is the iteration immediately after the current one, computed
 * from the current iteration's `end_date` the same way `nextIterationDates`
 * computes the next real row, stacking full `iterationLengthDays` blocks for
 * later offsets.
 */
export function projectedIterationDates(
  currentEndDate: string,
  iterationLengthDays: number,
  offset: number,
): { start_date: string; end_date: string } {
  const startMs = parseDateOnly(currentEndDate) + MS_PER_DAY + (offset - 1) * iterationLengthDays * MS_PER_DAY;
  const endMs = startMs + (iterationLengthDays - 1) * MS_PER_DAY;
  return { start_date: formatDateOnly(startMs), end_date: formatDateOnly(endMs) };
}
