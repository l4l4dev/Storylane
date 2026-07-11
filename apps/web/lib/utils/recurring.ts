// Pure date helpers for free-mode recurring stories (spec/data-model.md
// "recurring_stories").

export type RecurrenceRule = {
  cadence: "daily" | "weekly" | "monthly";
  weekday: number | null; // 0=Sun..6=Sat, required for "weekly"
  day_of_month: number | null; // 1-31, required for "monthly"; clamps to month end
};

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysInMonth(year: number, monthIndex0: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function clampedMonthlyDate(year: number, monthIndex0: number, dayOfMonth: number): Date {
  const day = Math.min(dayOfMonth, daysInMonth(year, monthIndex0));
  // JS normalizes an out-of-range monthIndex0 (e.g. -1) by rolling into the
  // adjacent year, same as the RPC's date_trunc('month', d - interval '1 day').
  return new Date(Date.UTC(year, monthIndex0, day));
}

/**
 * Mirrors the SQL date math in `generate_recurring_stories`
 * (supabase/migrations/20260709000008_recurring_stories.sql) — kept in
 * sync by hand and unit-tested here since the RPC itself has no automated
 * coverage of its own (same precedent as `acceptedPoints` cross-checking
 * `finalize_iteration` in velocity.test.ts). Never fed back into the RPC:
 * due dates are always computed server-side, not passed in by a client.
 */
export function mostRecentOccurrence(rule: RecurrenceRule, today: Date): Date {
  const t = utcMidnight(today);

  if (rule.cadence === "daily") {
    return t;
  }

  if (rule.cadence === "weekly") {
    if (rule.weekday == null) {
      throw new Error("weekly cadence requires a weekday");
    }
    const diff = ((t.getUTCDay() - rule.weekday) % 7 + 7) % 7;
    const result = new Date(t);
    result.setUTCDate(result.getUTCDate() - diff);
    return result;
  }

  if (rule.day_of_month == null) {
    throw new Error("monthly cadence requires a day_of_month");
  }
  const year = t.getUTCFullYear();
  const month = t.getUTCMonth();
  const thisMonth = clampedMonthlyDate(year, month, rule.day_of_month);
  if (thisMonth.getTime() <= t.getTime()) {
    return thisMonth;
  }
  return clampedMonthlyDate(year, month - 1, rule.day_of_month);
}

/**
 * The *next* occurrence strictly after `after` — a Settings UI preview
 * only ("next due: ..."), not cross-checked against the RPC and never used
 * to decide generation. Generation is exclusively the RPC's job.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date {
  const a = utcMidnight(after);

  if (rule.cadence === "daily") {
    const result = new Date(a);
    result.setUTCDate(result.getUTCDate() + 1);
    return result;
  }

  if (rule.cadence === "weekly") {
    if (rule.weekday == null) {
      throw new Error("weekly cadence requires a weekday");
    }
    const diff = (((rule.weekday - a.getUTCDay()) % 7 + 7) % 7) || 7;
    const result = new Date(a);
    result.setUTCDate(result.getUTCDate() + diff);
    return result;
  }

  if (rule.day_of_month == null) {
    throw new Error("monthly cadence requires a day_of_month");
  }
  const year = a.getUTCFullYear();
  const month = a.getUTCMonth();
  const thisMonth = clampedMonthlyDate(year, month, rule.day_of_month);
  if (thisMonth.getTime() > a.getTime()) {
    return thisMonth;
  }
  return clampedMonthlyDate(year, month + 1, rule.day_of_month);
}
