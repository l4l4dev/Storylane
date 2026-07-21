// Pure, framework-free working-day capacity math. See spec/velocity.md.
// Mirrors the SQL function public.project_capacity
// (supabase/migrations/20260720000002_iteration_capacity.sql); both are
// cross-checked against spec/fixtures/capacity.json.
//
// Dates are plain "YYYY-MM-DD" strings (matching the DB `date` type) so no
// local-timezone drift can shift a day across a boundary.

import { MS_PER_DAY, formatDateOnly, isoWeekday, parseDateOnly } from "./dates";

export type CalendarExceptionKind = "holiday" | "extra_workday";
export type CalendarException = { date: string; kind: CalendarExceptionKind };
export type MemberCalendar = { role: string; timeOff: ReadonlyArray<string> };

/**
 * Roles whose days count as capacity. `viewer` is excluded: a viewer cannot
 * be assigned a story, so counting their days would inflate the denominator
 * of the rate and under-forecast every future sprint. An allowlist, not a
 * `!== "viewer"` check, so a role added later has to opt in rather than land
 * in the math by default. Mirrors `project_capacity`'s `m.role in (...)`.
 */
const CAPACITY_ROLES: ReadonlySet<string> = new Set(["owner", "member"]);

export type CapacityInput = {
  /** ISO weekday numbers (1=Mon .. 7=Sun). Treated as a set — the DB CHECK cannot reject duplicates. */
  workingWeekdays: ReadonlyArray<number>;
  exceptions: ReadonlyArray<CalendarException>;
  members: ReadonlyArray<MemberCalendar>;
  start: string;
  end: string;
};

/**
 * Whether one day counts as a project working day: the weekday pattern, with
 * date exceptions overriding it either way. Shared by `workingDays` and
 * `nextWorkingDay` so the two can never disagree about what "working" means.
 */
function isWorkingDay(
  weekdays: ReadonlySet<number>,
  exceptionsByDate: ReadonlyMap<string, CalendarExceptionKind>,
  ms: number,
): boolean {
  const exception = exceptionsByDate.get(formatDateOnly(ms));
  if (exception === "holiday") {
    return false;
  }
  return exception === "extra_workday" || weekdays.has(isoWeekday(ms));
}

/** The project-level working days in [start, end], calendar exceptions applied. */
export function workingDays(
  workingWeekdays: ReadonlyArray<number>,
  exceptions: ReadonlyArray<CalendarException>,
  start: string,
  end: string,
): string[] {
  const weekdays = new Set(workingWeekdays);
  const byDate = new Map(exceptions.map((e) => [e.date, e.kind]));
  const days: string[] = [];

  for (let ms = parseDateOnly(start); ms <= parseDateOnly(end); ms += MS_PER_DAY) {
    if (isWorkingDay(weekdays, byDate, ms)) {
      days.push(formatDateOnly(ms));
    }
  }
  return days;
}

/**
 * First project-level working day on or after `from` — the TS mirror of
 * `public.next_working_day` (20260720000006_flexible_cadence.sql), which
 * decides where a 1-day iteration starts. `null` when a whole year holds no
 * working day, matching the SQL's bounded scan; callers fall back to `from`.
 *
 * Deliberately reads the PROJECT calendar only: one member's time off must
 * never make an iteration exist on a different day for the rest of the team.
 */
export function nextWorkingDay(
  workingWeekdays: ReadonlyArray<number>,
  exceptions: ReadonlyArray<CalendarException>,
  from: string,
): string | null {
  const weekdays = new Set(workingWeekdays);
  const byDate = new Map(exceptions.map((e) => [e.date, e.kind]));

  // Returns on the first hit — normally within 3 days. Building the whole
  // window and taking [0] instead cost ~370 iterations and ~260 string
  // allocations per call, on a path the board re-runs per projected sprint.
  let ms = parseDateOnly(from);
  for (let i = 0; i <= 366; i++, ms += MS_PER_DAY) {
    if (isWorkingDay(weekdays, byDate, ms)) {
      return formatDateOnly(ms);
    }
  }
  return null;
}

/**
 * Person-days available in [start, end]: Σ over members of the project's
 * working days, minus each member's own time off. No `joined_at` proration —
 * doc-8 §7 is "the member set at finalize time × every working day of the
 * sprint", matching the snapshot-at-that-moment meaning of the column.
 */
export function projectCapacity(input: CapacityInput): number {
  const days = workingDays(input.workingWeekdays, input.exceptions, input.start, input.end);
  return input.members.reduce((total, member) => {
    if (!CAPACITY_ROLES.has(member.role)) {
      return total;
    }
    const off = new Set(member.timeOff);
    return total + days.filter((day) => !off.has(day)).length;
  }, 0);
}
