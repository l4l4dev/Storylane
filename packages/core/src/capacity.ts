// Pure, framework-free working-day capacity math. See spec/velocity.md.
// Mirrors the SQL function public.project_capacity
// (supabase/migrations/20260720000002_iteration_capacity.sql); both are
// cross-checked against spec/fixtures/capacity.json.
//
// Dates are plain "YYYY-MM-DD" strings (matching the DB `date` type) so no
// local-timezone drift can shift a day across a boundary.

const MS_PER_DAY = 86_400_000;

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

function parseDateOnly(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO weekday (1=Mon .. 7=Sun) from a UTC-midnight timestamp. */
function isoWeekday(ms: number): number {
  return new Date(ms).getUTCDay() || 7;
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
    const date = formatDateOnly(ms);
    const exception = byDate.get(date);
    if (exception === "holiday") continue;
    if (exception === "extra_workday" || weekdays.has(isoWeekday(ms))) {
      days.push(date);
    }
  }
  return days;
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
