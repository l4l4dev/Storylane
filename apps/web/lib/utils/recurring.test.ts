import { describe, expect, it } from "vitest";
import { mostRecentOccurrence, nextOccurrence, type RecurrenceRule } from "./recurring";

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("mostRecentOccurrence", () => {
  it("daily: is always today", () => {
    const rule: RecurrenceRule = { cadence: "daily", weekday: null, day_of_month: null };
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 1, 8)))).toBe("2027-01-08");
  });

  it("weekly: today itself when today already matches the weekday", () => {
    // 2027-01-08 is a Friday (dow 5) — verified against Postgres extract(dow).
    const rule: RecurrenceRule = { cadence: "weekly", weekday: 5, day_of_month: null };
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 1, 8)))).toBe("2027-01-08");
  });

  it("weekly: the most recent past occurrence of the target weekday", () => {
    // Target Monday (1); 2027-01-08 is Friday (dow 5) -> most recent Monday is 2027-01-04.
    const rule: RecurrenceRule = { cadence: "weekly", weekday: 1, day_of_month: null };
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 1, 8)))).toBe("2027-01-04");
  });

  it("weekly: never looks more than 6 days back", () => {
    const rule: RecurrenceRule = { cadence: "weekly", weekday: 6, day_of_month: null };
    const today = utc(2027, 1, 8);
    const due = mostRecentOccurrence(rule, today);
    const diffDays = (today.getTime() - due.getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThanOrEqual(0);
    expect(diffDays).toBeLessThanOrEqual(6);
  });

  it("monthly: this month's occurrence when it has already happened", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 10 };
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 1, 15)))).toBe("2027-01-10");
  });

  it("monthly: today itself when today is exactly the target day", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 15 };
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 1, 15)))).toBe("2027-01-15");
  });

  it("monthly: falls back to last month's occurrence when this month's hasn't happened yet", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 20 };
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 1, 5)))).toBe("2026-12-20");
  });

  it("monthly clamping: day_of_month=31 in a 28-day February resolves to the 28th", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 31 };
    // 2027 is not a leap year.
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 2, 28)))).toBe("2027-02-28");
  });

  it("monthly clamping: day_of_month=31 in a leap February resolves to the 29th", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 31 };
    expect(isoDate(mostRecentOccurrence(rule, utc(2028, 2, 29)))).toBe("2028-02-29");
  });

  it("monthly clamping: falling back a month from March 1 with day_of_month=31 lands on Feb's clamped end, not Jan 31", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 31 };
    expect(isoDate(mostRecentOccurrence(rule, utc(2027, 3, 1)))).toBe("2027-02-28");
  });

  it("no-flooding: a rule untouched for months only ever reports the single most recent occurrence, not one per missed day", () => {
    // A daily rule last generated a month ago still reports only *today* as
    // due — the RPC's claim advances last_generated_on straight to that one
    // date, so a month of missed days never produces a month of cards.
    const rule: RecurrenceRule = { cadence: "daily", weekday: null, day_of_month: null };
    const due = mostRecentOccurrence(rule, utc(2027, 2, 1));
    expect(isoDate(due)).toBe("2027-02-01");
  });
});

describe("nextOccurrence", () => {
  it("daily: the day after", () => {
    const rule: RecurrenceRule = { cadence: "daily", weekday: null, day_of_month: null };
    expect(isoDate(nextOccurrence(rule, utc(2027, 1, 8)))).toBe("2027-01-09");
  });

  it("weekly: skips a full week when 'after' already matches the weekday", () => {
    const rule: RecurrenceRule = { cadence: "weekly", weekday: 5, day_of_month: null };
    expect(isoDate(nextOccurrence(rule, utc(2027, 1, 8)))).toBe("2027-01-15");
  });

  it("weekly: the next matching weekday otherwise", () => {
    const rule: RecurrenceRule = { cadence: "weekly", weekday: 1, day_of_month: null };
    expect(isoDate(nextOccurrence(rule, utc(2027, 1, 8)))).toBe("2027-01-11");
  });

  it("monthly: next month's clamped date when this month's has passed", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 31 };
    expect(isoDate(nextOccurrence(rule, utc(2027, 1, 31)))).toBe("2027-02-28");
  });

  it("monthly: later this month when the date hasn't happened yet", () => {
    const rule: RecurrenceRule = { cadence: "monthly", weekday: null, day_of_month: 20 };
    expect(isoDate(nextOccurrence(rule, utc(2027, 1, 5)))).toBe("2027-01-20");
  });
});
