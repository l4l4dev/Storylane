import { describe, expect, it } from "vitest";
import {
  MAX_PROJECTED_SPRINTS,
  assemblePlanningBudgets,
  estimatePlanningRange,
  rangeCovers,
} from "./planning-capacity";

describe("estimatePlanningRange", () => {
  it("looks back one iteration length past today and forward through the full projection horizon", () => {
    expect(estimatePlanningRange("2026-07-20", 14)).toEqual({
      start: "2026-07-05",
      end: "2027-08-02",
    });
  });

  it("scales with a 1-day cadence without collapsing to a zero-width range", () => {
    const range = estimatePlanningRange("2026-07-20", 1);
    expect(range.start).toBe("2026-07-18");
    expect(range.end).toBe("2026-08-16");
  });

  // The forward bound assumes the full MAX_PROJECTED_SPRINTS regardless of
  // backlog size — the real number of virtual sprints is always <= this, so
  // the estimate is always a safe superset of whatever the real range needs.
  it("always covers a real range built from at most MAX_PROJECTED_SPRINTS sprints", () => {
    const iterationLength = 7;
    const range = estimatePlanningRange("2026-07-20", iterationLength);
    const worstCaseEnd = "2026-07-20";
    for (let sprints = 0; sprints <= MAX_PROJECTED_SPRINTS; sprints++) {
      const end = new Date(Date.parse(`${worstCaseEnd}T00:00:00Z`) + sprints * iterationLength * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(end <= range.end).toBe(true);
    }
  });
});

describe("rangeCovers", () => {
  it("is true when the inner range sits fully inside the outer one", () => {
    expect(rangeCovers({ start: "2026-01-01", end: "2026-12-31" }, { start: "2026-06-01", end: "2026-06-30" })).toBe(
      true,
    );
  });

  it("is true for an exact match on both ends", () => {
    expect(rangeCovers({ start: "2026-06-01", end: "2026-06-30" }, { start: "2026-06-01", end: "2026-06-30" })).toBe(
      true,
    );
  });

  it("is false when the inner range starts before the outer one", () => {
    expect(rangeCovers({ start: "2026-06-01", end: "2026-06-30" }, { start: "2026-05-31", end: "2026-06-15" })).toBe(
      false,
    );
  });

  it("is false when the inner range ends after the outer one", () => {
    expect(rangeCovers({ start: "2026-06-01", end: "2026-06-30" }, { start: "2026-06-15", end: "2026-07-01" })).toBe(
      false,
    );
  });
});

describe("assemblePlanningBudgets", () => {
  const base = {
    rate: 2,
    workingWeekdays: [1, 2, 3, 4, 5],
    calendarUnavailable: false,
    exceptions: [],
    members: [{ userId: "u1", role: "member" }],
    timeOffByUser: new Map<string, string[]>(),
  };

  it("forecasts points from working days x rate for the current iteration and each projected sprint", () => {
    // Mon 2026-07-20 .. Fri 2026-07-24 = 5 working days for 1 member x rate 2.
    const result = assemblePlanningBudgets({
      ...base,
      currentIteration: { start: "2026-07-20", end: "2026-07-24" },
      projectedSprints: [{ start: "2026-07-27", end: "2026-07-31" }],
    });
    expect(result.currentBudget).toBe(10);
    expect(result.backlogBudgets).toEqual([10]);
  });

  it("subtracts a member's own time off from their working days", () => {
    const result = assemblePlanningBudgets({
      ...base,
      timeOffByUser: new Map([["u1", ["2026-07-21"]]]),
      currentIteration: { start: "2026-07-20", end: "2026-07-24" },
      projectedSprints: [],
    });
    expect(result.currentBudget).toBe(8);
  });

  it("degrades to 1 for every budget when the calendar read is unavailable, never overstating capacity", () => {
    const result = assemblePlanningBudgets({
      ...base,
      calendarUnavailable: true,
      currentIteration: { start: "2026-07-20", end: "2026-07-24" },
      projectedSprints: [{ start: "2026-07-27", end: "2026-07-31" }, { start: "2026-08-03", end: "2026-08-07" }],
    });
    expect(result.currentBudget).toBe(1);
    expect(result.backlogBudgets).toEqual([1, 1]);
  });

  it("returns a budget of 1 and no backlog budgets when there is no current iteration", () => {
    const result = assemblePlanningBudgets({
      ...base,
      currentIteration: null,
      projectedSprints: [],
    });
    expect(result.currentBudget).toBe(1);
    expect(result.backlogBudgets).toEqual([]);
  });

  // Not a real-world case (every project has at least its owner) — pinned
  // anyway because forecastPoints floors at 1 regardless of capacity, so
  // this looks identical to the calendarUnavailable fallback from the
  // outside; worth locking in that the extraction reaches it the same way.
  it("still floors at 1 (via forecastPoints) for a project with no capacity-counted members", () => {
    const result = assemblePlanningBudgets({
      ...base,
      members: [],
      currentIteration: { start: "2026-07-20", end: "2026-07-24" },
      projectedSprints: [],
    });
    expect(result.currentBudget).toBe(1);
  });
});
