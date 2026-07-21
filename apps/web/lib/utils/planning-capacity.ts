// TASK-99: the board's planning-capacity assembly (which calendar dates to
// query, mapping projected sprints to point budgets), extracted out of
// board/page.tsx so a future consumer (My Work, auto-assignment) can reuse
// it instead of re-deriving the same "do viewers count / what if the
// calendar read fails" questions the TASK-86 review already settled.
//
// The current-iteration date range this needs is only known after the
// board's main query batch resolves (it comes from the `iterations` row
// that batch fetches) — querying calendar data only then would add a third
// serial round trip on the hottest page. `project.iteration_length` and
// today's date are both known before that batch, so `startPlanningCapacityFetch`
// fires the calendar reads early, using a range wide enough to almost always
// cover the real one; `resolvePlanningCapacity` (called after the main batch,
// once the real range is known) falls back to one exact, targeted read only
// for the rare iteration the estimate didn't cover.

import type { createClient } from "@/lib/supabase/server";
import { forecastPoints, projectCapacity, addDays, type CalendarException } from "@storylane/core";
import { readWasTruncated } from "./capacity-guard";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CapacityMember = { userId: string; role: string };
type DateRange = { start: string; end: string };
// `kind` is untyped string from PostgREST (the DB CHECK constrains it, not
// the client) — narrowed with `as CalendarException[]` where consumed, same
// as the pre-extraction code did.
type ExceptionRow = { date: string; kind: string };
type TimeOffRow = { user_id: string; date: string };
type CountedResult<T> = { data: T[] | null; error: unknown; count: number | null };

// Capped because the backlog can outrun any sensible planning horizon;
// board/page.tsx's buildBacklogRows repeats the last budget past this many
// virtual sprints. Also the forward bound of the estimated fetch range below
// — the real number of projected sprints (bounded by backlog size) is
// always <= this, so estimating with the max is always a safe superset.
export const MAX_PROJECTED_SPRINTS = 26;

/**
 * A range wide enough to almost always contain the real
 * [currentIteration.start_date, lastProjectedSprint.end_date] span, computed
 * from data known before the current iteration is: back far enough that an
 * iteration which hasn't rolled over in a while is still inside it, forward
 * through the full projection horizon at this cadence.
 */
export function estimatePlanningRange(today: string, iterationLength: number): DateRange {
  return {
    start: addDays(today, -(iterationLength + 1)),
    end: addDays(today, iterationLength * (MAX_PROJECTED_SPRINTS + 1)),
  };
}

/** Whether `outer` fully contains `inner` — plain string compare, dates sort lexically. */
export function rangeCovers(outer: DateRange, inner: DateRange): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export type PlanningCapacityFetch = {
  range: DateRange;
  exceptions: Promise<CountedResult<ExceptionRow>>;
  timeOff: Promise<CountedResult<TimeOffRow>>;
};

/**
 * Starts the two calendar reads on the estimated range. Call this alongside
 * the board page's own main query batch (not after `await`ing it) so both
 * fire over the wire at the same time — the whole point of estimating the
 * range instead of waiting to know the exact one.
 */
export function startPlanningCapacityFetch(
  supabase: SupabaseServerClient,
  projectId: string,
  memberUserIds: ReadonlyArray<string>,
  today: string,
  iterationLength: number,
): PlanningCapacityFetch {
  const range = estimatePlanningRange(today, iterationLength);
  return {
    range,
    exceptions: Promise.resolve(
      supabase
        .from("project_calendar_exceptions")
        .select("date, kind", { count: "exact" })
        .eq("project_id", projectId)
        .gte("date", range.start)
        .lte("date", range.end),
    ),
    // .in() with an empty array is a malformed filter, not "match nothing" —
    // skip the request rather than rely on that edge case.
    timeOff:
      memberUserIds.length > 0
        ? Promise.resolve(
            supabase
              .from("user_time_off")
              .select("user_id, date", { count: "exact" })
              .in("user_id", memberUserIds)
              .gte("date", range.start)
              .lte("date", range.end),
          )
        : Promise.resolve({ data: [], error: null, count: 0 }),
  };
}

/**
 * Person-day budget per member calendar (spec/velocity.md): the project's
 * working days in range, minus each member's own time off, restricted to
 * roles that count toward capacity (packages/core's projectCapacity already
 * excludes viewers). Pure — the same "budget-mapping" arithmetic board/page.tsx
 * used to inline, now testable without a Supabase client or React render.
 */
export function assemblePlanningBudgets(input: {
  rate: number;
  workingWeekdays: ReadonlyArray<number>;
  calendarUnavailable: boolean;
  exceptions: ReadonlyArray<CalendarException>;
  members: ReadonlyArray<CapacityMember>;
  timeOffByUser: ReadonlyMap<string, ReadonlyArray<string>>;
  currentIteration: DateRange | null;
  projectedSprints: ReadonlyArray<DateRange>;
}): { currentBudget: number; backlogBudgets: number[] } {
  const memberCalendars = input.members.map((m) => ({
    role: m.role,
    timeOff: input.timeOffByUser.get(m.userId) ?? [],
  }));
  const budgetFor = (range: DateRange) =>
    input.calendarUnavailable
      ? 1
      : forecastPoints(
          input.rate,
          projectCapacity({
            workingWeekdays: input.workingWeekdays,
            exceptions: input.exceptions,
            members: memberCalendars,
            start: range.start,
            end: range.end,
          }),
        );
  return {
    currentBudget: input.currentIteration ? budgetFor(input.currentIteration) : 1,
    backlogBudgets: input.projectedSprints.map(budgetFor),
  };
}

/**
 * Resolves a fetch `startPlanningCapacityFetch` already started, now that the
 * real current-iteration range is known from the main query batch, into
 * per-sprint point budgets. A failed OR truncated read must not silently
 * become "no holidays, nobody away" — that overstates capacity and
 * over-commits the team, so it degrades to the minimum-1 fallback instead
 * (TASK-86 / TASK-100), same as an estimate that didn't cover the real range
 * and still comes back truncated on the exact retry.
 */
export async function resolvePlanningCapacity(
  supabase: SupabaseServerClient,
  projectId: string,
  fetch: PlanningCapacityFetch,
  params: {
    rate: number;
    workingWeekdays: ReadonlyArray<number>;
    capacityMembers: ReadonlyArray<CapacityMember>;
    currentIteration: DateRange | null;
    projectedSprints: ReadonlyArray<DateRange>;
  },
): Promise<{ currentBudget: number; backlogBudgets: number[] }> {
  const { rate, workingWeekdays, capacityMembers, currentIteration, projectedSprints } = params;

  let exceptionResult = await fetch.exceptions;
  let timeOffResult = await fetch.timeOff;

  // Only a real current iteration has a range worth checking; without one
  // assemblePlanningBudgets already degrades to 1/[] on its own (matching
  // the pre-extraction behavior), so there's nothing to re-fetch for.
  const neededRange: DateRange | null = currentIteration && {
    start: currentIteration.start,
    end: projectedSprints[projectedSprints.length - 1]?.end ?? currentIteration.end,
  };

  // The estimate almost always covers the real range (estimatePlanningRange);
  // the rare iteration stretched or skipped outside it needs one exact,
  // targeted read instead of silently under-counting. This is the only path
  // that can still add a serial round trip, and it's uncommon by construction.
  if (neededRange && !rangeCovers(fetch.range, neededRange)) {
    const memberUserIds = capacityMembers.map((m) => m.userId);
    [exceptionResult, timeOffResult] = await Promise.all([
      supabase
        .from("project_calendar_exceptions")
        .select("date, kind", { count: "exact" })
        .eq("project_id", projectId)
        .gte("date", neededRange.start)
        .lte("date", neededRange.end),
      memberUserIds.length > 0
        ? supabase
            .from("user_time_off")
            .select("user_id, date", { count: "exact" })
            .in("user_id", memberUserIds)
            .gte("date", neededRange.start)
            .lte("date", neededRange.end)
        : Promise.resolve({ data: [], error: null, count: 0 }),
    ]);
  }

  const calendarUnavailable =
    exceptionResult.error !== null ||
    timeOffResult.error !== null ||
    readWasTruncated(exceptionResult.count, exceptionResult.data?.length ?? 0) ||
    readWasTruncated(timeOffResult.count, timeOffResult.data?.length ?? 0);

  const timeOffByUser = new Map<string, string[]>();
  for (const row of timeOffResult.data ?? []) {
    const dates = timeOffByUser.get(row.user_id);
    if (dates) {
      dates.push(row.date);
    } else {
      timeOffByUser.set(row.user_id, [row.date]);
    }
  }

  return assemblePlanningBudgets({
    rate,
    workingWeekdays,
    calendarUnavailable,
    exceptions: (exceptionResult.data ?? []) as CalendarException[],
    members: capacityMembers,
    timeOffByUser,
    currentIteration,
    projectedSprints,
  });
}
