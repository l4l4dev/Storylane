// Pure, framework-free helpers for iterations. See spec/velocity.md.
// Dates are handled as plain "YYYY-MM-DD" strings (matching the DB `date`
// type) to avoid local-timezone drift when comparing against "today".

import { MS_PER_DAY, addDays, daysBetween, formatDateOnly, nextWorkingDay, parseDateOnly } from "@storylane/core";
import { storyTypeUsesPoints } from "./stories";
import { formatDate } from "./format";

/**
 * How long an inclusive date range runs, shown while the end date is being
 * edited so a whole-week span is visible as such (doc-8 §4 talks about
 * lengthening a sprint in whole weeks) without a separate week control.
 */
export function iterationSpanLabel(startDate: string, endDate: string): string {
  const days = daysBetween(startDate, endDate) + 1;
  // NaN when the picker has been cleared — `< 1` alone lets it through and
  // renders the string "NaN days".
  if (!Number.isFinite(days) || days < 1) {
    return "";
  }
  const unit = days === 1 ? "day" : "days";
  if (days % 7 !== 0) {
    return `${days} ${unit}`;
  }
  const weeks = days / 7;
  return `${days} ${unit} (${weeks} ${weeks === 1 ? "week" : "weeks"})`;
}

/**
 * How an iteration is titled (doc-8 §5). The term is per-project free text
 * ("Sprint", "Cycle", ...). At a 1-day cadence the number is title noise —
 * "#137" says nothing a team can hold on to — so the date takes its place;
 * `startDate` is the iteration's own start, not today.
 */
export function iterationLabel(
  term: string,
  number: number,
  iterationLengthDays: number,
  startDate?: string,
): string {
  if (iterationLengthDays === 1 && startDate) {
    return formatDate(startDate);
  }
  return `${term} #${number}`;
}

export type BacklogStoryForMarkers = { points: number | null; story_type: string };

/**
 * Point budget for the virtual group at `groupIndex` (0-based). Each future
 * sprint gets its own budget — `rate × that sprint's planned capacity`
 * (spec/velocity.md) — so a sprint straddling a holiday week holds fewer
 * points than the one after it. `budgets` runs out once the backlog outruns
 * the sprints the caller projected; the last entry then repeats, and an
 * empty array falls back to the minimum 1 point that keeps splitting
 * progressing before any capacity history exists.
 */
function budgetFor(budgets: ReadonlyArray<number>, groupIndex: number): number {
  return Math.max(budgets[Math.min(groupIndex, budgets.length - 1)] ?? 0, 1);
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
 * Two passes: first walk the items top-down accumulating points — an
 * `iteration_break` unconditionally closes the current group — but buffer
 * each group's rows instead of emitting them immediately, since the header
 * needs the group's total *before* its first row. Then flatten, assigning
 * sequential numbers only to groups (a break's own row carries none).
 *
 * `budgets[i]` is the point budget for the i-th group; see `budgetFor`.
 *
 * A `note` doesn't affect the point count, but which group it lands in
 * isn't decided the moment it's seen — a note sitting right where an
 * automatic (capacity) split falls doesn't yet know whether it precedes
 * that split or opens the group after it. It's held in `pendingNotes` until
 * the next story or break resolves the question. A capacity split flushes
 * pending notes into the group that *opens* (the split is only discovered
 * once the following story's cost is known, by which point the note must
 * already belong to that story's new group). A manual break instead flushes
 * them into the group it *closes* — the break itself always closes
 * unconditionally the moment it's seen, so a note right before it never has
 * anywhere else to go; this matches how a manual break already attached
 * notes correctly before this fix.
 */
export function buildBacklogRows<T extends BacklogStoryForMarkers & { id: string }>(
  items: ReadonlyArray<BacklogRowItem<T>>,
  budgets: ReadonlyArray<number>,
  startingIterationNumber: number,
): BacklogRow<T>[] {
  type Segment =
    | { kind: "group"; rows: BacklogRow<T>[]; points: number }
    | { kind: "break"; divider: BacklogDivider };

  const segments: Segment[] = [];
  let groupRows: BacklogRow<T>[] = [];
  let sum = 0;
  let groupHasItem = false;
  let pendingNotes: BacklogDivider[] = [];
  let groupIndex = 0;
  let budget = budgetFor(budgets, 0);

  function flushPendingNotes() {
    for (const divider of pendingNotes) {
      groupRows.push({ kind: "note", divider });
    }
    pendingNotes = [];
  }

  function closeGroup() {
    segments.push({ kind: "group", rows: groupRows, points: sum });
    groupRows = [];
    sum = 0;
    groupHasItem = false;
    groupIndex += 1;
    budget = budgetFor(budgets, groupIndex);
  }

  for (const item of items) {
    if (item.kind === "divider") {
      if (item.divider.kind === "note") {
        pendingNotes.push(item.divider);
      } else {
        flushPendingNotes();
        closeGroup();
        segments.push({ kind: "break", divider: item.divider });
      }
      continue;
    }

    const cost = storyTypeUsesPoints(item.story.story_type) ? item.story.points ?? 0 : 0;
    if (groupHasItem && sum + cost > budget) {
      closeGroup();
    }
    flushPendingNotes();
    groupRows.push({ kind: "story", story: item.story });
    sum += cost;
    groupHasItem = true;
  }
  flushPendingNotes();
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
 * Finds the id (`"story:<id>"` / `"divider:<id>"`) of the next *real* row at
 * or after `fromIndex` — skipping over header rows, which aren't stored
 * rows and so have nothing to anchor an insertion to. `null` means "insert
 * at the end" (no real row follows). Shared by the hover insert-between
 * insert-between affordance — it needs the same "what comes after this
 * point" answer while skipping generated headers.
 */
export function nextRealRowId<T extends BacklogStoryForMarkers & { id: string }>(
  rows: ReadonlyArray<BacklogRow<T>>,
  fromIndex: number,
): string | null {
  for (let i = fromIndex; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "story") {
      return `story:${row.story.id}`;
    }
    if (row.kind === "note" || row.kind === "iteration-break") {
      return `divider:${row.divider.id}`;
    }
  }
  return null;
}

/**
 * Projected date range for a virtual (not-yet-real) iteration, shown on its
 * Backlog group header (spec/screens.md "Backlog groups"). `offset` is
 * 1-based: 1 is the iteration immediately after the current one, computed
 * from the current iteration's `end_date` the same way `nextIterationDates`
 * computes the next real row, stacking full `iterationLengthDays` blocks for
 * later offsets.
 *
 * At a 1-day cadence plain arithmetic is wrong: `finalize_iteration` starts
 * each row on a working day and runs it to the day before the next one, so a
 * naive projection lands on weekends no real iteration will ever occupy —
 * and the header would then be *titled* by that impossible date
 * (`iterationLabel`). `workingWeekdays` applies the same rule here.
 *
 * ponytail: weekday pattern only, no project_calendar_exceptions — a holiday
 * inside the horizon shifts a forecast by a day. Threading the exceptions in
 * means fetching them before the projection that currently bounds their own
 * query range (board/page.tsx), so it waits until a forecast that precise is
 * asked for.
 */
export function projectedIterationDates(
  currentEndDate: string,
  iterationLengthDays: number,
  offset: number,
  workingWeekdays?: ReadonlyArray<number>,
): { start_date: string; end_date: string } {
  if (iterationLengthDays === 1 && workingWeekdays && workingWeekdays.length > 0) {
    let start = addDays(currentEndDate, 1);
    let end = start;
    for (let i = 0; i < offset; i++) {
      start = i === 0 ? start : addDays(end, 1);
      start = nextWorkingDay(workingWeekdays, [], start) ?? start;
      // The row covers every day up to the next working one, so a Friday
      // spans Fri-Sun and nothing falls between iterations.
      end = addDays(nextWorkingDay(workingWeekdays, [], addDays(start, 1)) ?? addDays(start, 1), -1);
    }
    return { start_date: start, end_date: end };
  }

  const startMs = parseDateOnly(currentEndDate) + MS_PER_DAY + (offset - 1) * iterationLengthDays * MS_PER_DAY;
  const endMs = startMs + (iterationLengthDays - 1) * MS_PER_DAY;
  return { start_date: formatDateOnly(startMs), end_date: formatDateOnly(endMs) };
}
