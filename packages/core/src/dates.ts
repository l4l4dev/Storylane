// Wall-date arithmetic on plain "YYYY-MM-DD" strings, matching the DB `date`
// type. Calendar dates (iteration bounds, holidays, time off) are wall dates,
// not instants — parsing them as UTC midnight and formatting from the digits
// keeps a local timezone from shifting a day across a boundary.
//
// Single source of truth: capacity math (this package) and the web app's
// iteration helpers both build on these, and both have to stay in lockstep
// with the SQL that computes the same boundaries.

export const MS_PER_DAY = 86_400_000;

export function parseDateOnly(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function formatDateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO weekday (1=Mon .. 7=Sun) from a UTC-midnight timestamp. */
export function isoWeekday(ms: number): number {
  return new Date(ms).getUTCDay() || 7;
}

/** The date `days` after `dateStr` (negative goes back). */
export function addDays(dateStr: string, days: number): string {
  return formatDateOnly(parseDateOnly(dateStr) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`, negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateOnly(to) - parseDateOnly(from)) / MS_PER_DAY);
}
