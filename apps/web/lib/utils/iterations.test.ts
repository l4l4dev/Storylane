import { describe, expect, it } from "vitest";
import {
  autoAssignStoryIds,
  buildBacklogRows,
  isIterationEditable,
  projectedIterationDates,
  splitBacklogIntoVirtualIterations,
  type BacklogRowItem,
} from "./iterations";

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
  // TASK-9: every group renders under its own header, starting at
  // current+1 — replaces the old boundary-marker-after-the-group scheme,
  // where the first group had no label at all (spec/screens.md "Backlog
  // groups").
  it("headers every group, including the first, with its own number and point sum", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), storyItem(b)], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "iteration-header", number: 4, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: b },
    ]);
  });

  it("passes a note through inside whichever group it falls in, without affecting point accounting", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), noteItem("d1", "Phase 2"), storyItem(b)], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "note", divider: { id: "d1", label: "Phase 2", kind: "note" } },
      { kind: "iteration-header", number: 4, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: b },
    ]);
  });

  it("returns an empty list for an empty backlog", () => {
    expect(buildBacklogRows([], 8, 3)).toEqual([]);
  });

  it("still headers a single group that never splits, numbered current+1", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([noteItem("d1", "Notes"), storyItem(a)], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 1, manualBreakDividerId: undefined },
      { kind: "note", divider: { id: "d1", label: "Notes", kind: "note" } },
      { kind: "story", story: a },
    ]);
  });

  it("forces a group boundary at a manual iteration break regardless of remaining capacity, and stamps the following header with the break's id", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const b = { id: "b", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), iterationBreakItem("brk"), storyItem(b)], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 1, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "iteration-break", divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 4, points: 1, manualBreakDividerId: "brk" },
      { kind: "story", story: b },
    ]);
  });

  it("a manual break right after an automatic split still advances the group number, and the trailing group also gets a header", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const c = { id: "c", points: 1, story_type: "feature" };
    // a+b exceed capacity 8 -> automatic split before b; then a manual break
    // right after b forces a third group for c even though b+c (=6) would fit.
    const rows = buildBacklogRows([storyItem(a), storyItem(b), iterationBreakItem("brk"), storyItem(c)], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      // Automatic split, not a manual break — no id stamped here either.
      { kind: "iteration-header", number: 4, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: b },
      { kind: "iteration-break", divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 5, points: 1, manualBreakDividerId: "brk" },
      { kind: "story", story: c },
    ]);
  });

  it("a break with nothing accumulated yet still renders its own (empty) header before the break row", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([iterationBreakItem("brk"), storyItem(a)], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 0, manualBreakDividerId: undefined },
      { kind: "iteration-break", divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 4, points: 1, manualBreakDividerId: "brk" },
      { kind: "story", story: a },
    ]);
  });

  it("numbering has no gaps across multiple automatic and manual splits", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const b = { id: "b", points: 1, story_type: "feature" };
    const c = { id: "c", points: 1, story_type: "feature" };
    const rows = buildBacklogRows(
      [storyItem(a), iterationBreakItem("brk1"), storyItem(b), iterationBreakItem("brk2"), storyItem(c)],
      1,
      3,
    );
    const numbers = rows.filter((r) => r.kind === "iteration-header").map((r) => r.number);
    expect(numbers).toEqual([3, 4, 5]);
  });

  // A manual break as the very last item still opens a (possibly empty)
  // group after it, symmetric with a *leading* break's empty group before
  // it — otherwise dropping a break at the bottom of the backlog would look
  // like it did nothing, and there'd be no header to drop the next story
  // under.
  it("a manual break as the very last item still renders an (empty) header for the group after it", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), iterationBreakItem("brk")], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 1, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "iteration-break", divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 4, points: 0, manualBreakDividerId: "brk" },
    ]);
  });

  it("consecutive manual breaks each still get their own (empty) header, each stamped with its own break's id", () => {
    const rows = buildBacklogRows([iterationBreakItem("brk1"), iterationBreakItem("brk2")], 8, 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 0, manualBreakDividerId: undefined },
      { kind: "iteration-break", divider: { id: "brk1", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 4, points: 0, manualBreakDividerId: "brk1" },
      { kind: "iteration-break", divider: { id: "brk2", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 5, points: 0, manualBreakDividerId: "brk2" },
    ]);
  });
});

describe("projectedIterationDates", () => {
  it("offset 1 starts the day after the current iteration ends", () => {
    expect(projectedIterationDates("2026-07-20", 14, 1)).toEqual({
      start_date: "2026-07-21",
      end_date: "2026-08-03",
    });
  });

  it("later offsets stack full iteration lengths after the first", () => {
    expect(projectedIterationDates("2026-07-20", 14, 2)).toEqual({
      start_date: "2026-08-04",
      end_date: "2026-08-17",
    });
  });

  it("handles month/year boundaries", () => {
    expect(projectedIterationDates("2026-12-28", 7, 1)).toEqual({
      start_date: "2026-12-29",
      end_date: "2027-01-04",
    });
  });
});
