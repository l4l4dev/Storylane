import { describe, expect, it } from "vitest";
import {
  autoAssignStoryIds,
  isCurrentIteration,
  isIterationEditable,
  nextIterationDates,
  nextIterationNumber,
} from "./iterations";

describe("nextIterationNumber", () => {
  it("returns 1 for a project with no iterations yet", () => {
    expect(nextIterationNumber([])).toBe(1);
  });

  it("returns one past the highest existing number", () => {
    expect(nextIterationNumber([{ number: 1 }, { number: 3 }, { number: 2 }])).toBe(4);
  });
});

describe("nextIterationDates", () => {
  it("starts today for the first iteration", () => {
    expect(nextIterationDates([], 14, "2026-07-01")).toEqual({
      start_date: "2026-07-01",
      end_date: "2026-07-14",
    });
  });

  it("starts the day after the latest existing iteration ends", () => {
    const iterations = [{ end_date: "2026-07-14" }, { end_date: "2026-06-30" }];
    expect(nextIterationDates(iterations, 7, "2026-07-01")).toEqual({
      start_date: "2026-07-15",
      end_date: "2026-07-21",
    });
  });

  it("handles month/year boundaries", () => {
    expect(nextIterationDates([{ end_date: "2026-12-28" }], 7, "2026-07-01")).toEqual({
      start_date: "2026-12-29",
      end_date: "2027-01-04",
    });
  });
});

describe("isCurrentIteration", () => {
  it("is true when today falls within the date range and it isn't done", () => {
    expect(
      isCurrentIteration(
        { start_date: "2026-06-25", end_date: "2026-07-08", state: "planned" },
        "2026-07-01",
      ),
    ).toBe(true);
  });

  it("is false when today is outside the date range", () => {
    expect(
      isCurrentIteration(
        { start_date: "2026-07-02", end_date: "2026-07-15", state: "planned" },
        "2026-07-01",
      ),
    ).toBe(false);
  });

  it("is false once the iteration is done, even if today is in range", () => {
    expect(
      isCurrentIteration(
        { start_date: "2026-06-25", end_date: "2026-07-08", state: "done" },
        "2026-07-01",
      ),
    ).toBe(false);
  });
});

describe("isIterationEditable", () => {
  it("is false once an iteration is done", () => {
    expect(isIterationEditable({ state: "done" })).toBe(false);
  });

  it("is true for planned or otherwise non-done states", () => {
    expect(isIterationEditable({ state: "planned" })).toBe(true);
    expect(isIterationEditable({ state: "active" })).toBe(true);
  });
});

describe("autoAssignStoryIds", () => {
  it("fills up to the velocity budget", () => {
    const backlog = [
      { id: "1", points: 3, story_type: "feature" },
      { id: "2", points: 5, story_type: "feature" },
      { id: "3", points: 2, story_type: "bug" },
    ];
    expect(autoAssignStoryIds(backlog, 8)).toEqual(["1", "2"]);
  });

  it("always includes at least the first story, even if it exceeds the budget", () => {
    const backlog = [{ id: "1", points: 13, story_type: "feature" }];
    expect(autoAssignStoryIds(backlog, 5)).toEqual(["1"]);
  });

  it("pulls in chore/release stories without them counting against the budget", () => {
    const backlog = [
      { id: "1", points: 3, story_type: "feature" },
      { id: "2", points: null, story_type: "chore" },
      { id: "3", points: 5, story_type: "feature" },
    ];
    expect(autoAssignStoryIds(backlog, 8)).toEqual(["1", "2", "3"]);
  });

  it("assigns nothing when velocity is 0", () => {
    const backlog = [{ id: "1", points: 3, story_type: "feature" }];
    expect(autoAssignStoryIds(backlog, 0)).toEqual([]);
  });

  it("assigns nothing for an empty backlog", () => {
    expect(autoAssignStoryIds([], 10)).toEqual([]);
  });
});
