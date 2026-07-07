import { describe, expect, it } from "vitest";
import {
  autoAssignStoryIds,
  buildBacklogRows,
  isCurrentIteration,
  isIterationEditable,
  nextIterationDates,
  nextIterationNumber,
  splitBacklogIntoVirtualIterations,
  type BacklogRowItem,
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

describe("splitBacklogIntoVirtualIterations", () => {
  it("breaks a new group once the next story would exceed capacity", () => {
    const backlog = [
      { points: 3, story_type: "feature" },
      { points: 5, story_type: "feature" },
      { points: 2, story_type: "feature" },
    ];
    expect(splitBacklogIntoVirtualIterations(backlog, 8)).toEqual([
      [backlog[0], backlog[1]],
      [backlog[2]],
    ]);
  });

  it("gives a single oversized story its own group", () => {
    const backlog = [
      { points: 13, story_type: "feature" },
      { points: 2, story_type: "feature" },
    ];
    expect(splitBacklogIntoVirtualIterations(backlog, 5)).toEqual([[backlog[0]], [backlog[1]]]);
  });

  it("never breaks a group on a chore/release/unestimated story since they cost 0", () => {
    const backlog = [
      { points: 3, story_type: "feature" },
      { points: null, story_type: "chore" },
      { points: null, story_type: "release" },
      { points: 5, story_type: "feature" },
    ];
    expect(splitBacklogIntoVirtualIterations(backlog, 8)).toEqual([backlog]);
  });

  it("floors capacity at 1 point when velocity is 0", () => {
    const backlog = [
      { points: 1, story_type: "feature" },
      { points: 1, story_type: "feature" },
    ];
    expect(splitBacklogIntoVirtualIterations(backlog, 0)).toEqual([[backlog[0]], [backlog[1]]]);
  });

  it("returns no groups for an empty backlog", () => {
    expect(splitBacklogIntoVirtualIterations([], 8)).toEqual([]);
  });
});

type Story = { id: string; points: number | null; story_type: string };

function storyItem(story: Story): BacklogRowItem<Story> {
  return { kind: "story", story };
}

function noteItem(id: string, label: string): BacklogRowItem<Story> {
  return { kind: "divider", divider: { id, label, kind: "note" } };
}

function iterationBreakItem(id: string): BacklogRowItem<Story> {
  return { kind: "divider", divider: { id, label: "", kind: "iteration_break" } };
}

describe("buildBacklogRows", () => {
  it("inserts an iteration marker only when a story crosses into the next group", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), storyItem(b)], 8, 3);
    expect(rows).toEqual([
      { kind: "story", story: a },
      { kind: "iteration-marker", number: 4, points: 5 },
      { kind: "story", story: b },
    ]);
  });

  it("passes a note through at its own position without affecting point accounting", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), noteItem("d1", "Phase 2"), storyItem(b)], 8, 3);
    expect(rows).toEqual([
      { kind: "story", story: a },
      { kind: "note", divider: { id: "d1", label: "Phase 2", kind: "note" } },
      { kind: "iteration-marker", number: 4, points: 5 },
      { kind: "story", story: b },
    ]);
  });

  it("returns an empty list for an empty backlog", () => {
    expect(buildBacklogRows([], 8, 3)).toEqual([]);
  });

  it("emits no iteration marker when everything fits in the first group", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([noteItem("d1", "Notes"), storyItem(a)], 8, 3);
    expect(rows).toEqual([
      { kind: "note", divider: { id: "d1", label: "Notes", kind: "note" } },
      { kind: "story", story: a },
    ]);
  });

  it("forces a group boundary at a manual iteration break regardless of remaining capacity", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const b = { id: "b", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), iterationBreakItem("brk"), storyItem(b)], 8, 3);
    expect(rows).toEqual([
      { kind: "story", story: a },
      { kind: "iteration-marker", number: 4, points: 1, divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "story", story: b },
    ]);
  });

  it("a manual break right after an automatic split still advances the group number", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const c = { id: "c", points: 1, story_type: "feature" };
    // a+b exceed capacity 8 -> automatic split before b; then a manual break
    // right after b forces a third group for c even though b+c (=6) would fit.
    const rows = buildBacklogRows([storyItem(a), storyItem(b), iterationBreakItem("brk"), storyItem(c)], 8, 3);
    expect(rows).toEqual([
      { kind: "story", story: a },
      { kind: "iteration-marker", number: 4, points: 5 },
      { kind: "story", story: b },
      { kind: "iteration-marker", number: 5, points: 5, divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "story", story: c },
    ]);
  });

  it("a break with nothing accumulated yet still renders as its own (empty) iteration", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([iterationBreakItem("brk"), storyItem(a)], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-marker", number: 4, points: 0, divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "story", story: a },
    ]);
  });
});
