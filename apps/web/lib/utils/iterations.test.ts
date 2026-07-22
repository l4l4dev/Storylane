import { describe, expect, it } from "vitest";
import {
  buildBacklogRows,
  iterationLabel,
  iterationSpanLabel,
  nextRealRowId,
  projectedIterationDates,
  type BacklogRowItem,
} from "./iterations";

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
    const rows = buildBacklogRows([storyItem(a), storyItem(b)], [8], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "iteration-header", number: 4, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: b },
    ]);
  });

  it("passes a note through without affecting point accounting, when it doesn't sit on a capacity boundary", () => {
    const a = { id: "a", points: 2, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), noteItem("d1", "Phase 2"), storyItem(b)], [8], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 7, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "note", divider: { id: "d1", label: "Phase 2", kind: "note" } },
      { kind: "story", story: b },
    ]);
  });

  // TASK-60: a note inserted directly above the first story of an automatic
  // (capacity) split used to attach to the end of the *previous* group
  // instead — because it was pushed into the current group's row buffer the
  // moment it was seen, before the following story's cost was known to
  // trigger the split. A manual break never had this asymmetry (it closes
  // its group unconditionally, before anything after it is seen), so the
  // fix holds notes in a pending buffer until the next story/break resolves
  // which group actually owns that position.
  it("attaches a note to the group it opens, not the one it closes, when it sits right on an automatic split", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), noteItem("d1", "Phase 2"), storyItem(b)], [8], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 5, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "iteration-header", number: 4, points: 5, manualBreakDividerId: undefined },
      { kind: "note", divider: { id: "d1", label: "Phase 2", kind: "note" } },
      { kind: "story", story: b },
    ]);
  });

  it("still attaches a note to the group it closes when the following item stays in that group", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    // a+note+b all fit in one group (capacity 20) — the note has nothing to
    // resolve toward, so it stays right where it was inserted.
    const rows = buildBacklogRows([storyItem(a), noteItem("d1", "Phase 2"), storyItem(b)], [20], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 10, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "note", divider: { id: "d1", label: "Phase 2", kind: "note" } },
      { kind: "story", story: b },
    ]);
  });

  // fable-advisor review 2026-07-17 (post-TASK-60 fix): a manual break
  // resolves the pending-notes question the opposite way an automatic split
  // does — the break always closes its group unconditionally the instant
  // it's seen, so a note right before it never has anywhere else to go but
  // the group it closes (the group *before* the break), not the one after.
  it("attaches a note to the group it closes (not opens) when it sits right before a manual break", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const b = { id: "b", points: 1, story_type: "feature" };
    const rows = buildBacklogRows(
      [storyItem(a), noteItem("d1", "Phase 2"), iterationBreakItem("brk"), storyItem(b)],
      [8],
      3,
    );
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 1, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "note", divider: { id: "d1", label: "Phase 2", kind: "note" } },
      { kind: "iteration-break", divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 4, points: 1, manualBreakDividerId: "brk" },
      { kind: "story", story: b },
    ]);
  });

  // fable-advisor review 2026-07-17 (post-TASK-60 fix): a trailing note with
  // nothing after it must still flush from `pendingNotes` into the final
  // group — the loop only flushes when a subsequent story/break is seen, so
  // this exercises the post-loop flush that catches the no-next-item case.
  it("flushes a trailing note into the final group when nothing follows it", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), noteItem("d1", "Phase 2")], [8], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 1, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "note", divider: { id: "d1", label: "Phase 2", kind: "note" } },
    ]);
  });

  it("returns an empty list for an empty backlog", () => {
    expect(buildBacklogRows([], [8], 3)).toEqual([]);
  });

  it("still headers a single group that never splits, numbered current+1", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([noteItem("d1", "Notes"), storyItem(a)], [8], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 1, manualBreakDividerId: undefined },
      { kind: "note", divider: { id: "d1", label: "Notes", kind: "note" } },
      { kind: "story", story: a },
    ]);
  });

  it("forces a group boundary at a manual iteration break regardless of remaining capacity, and stamps the following header with the break's id", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const b = { id: "b", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), iterationBreakItem("brk"), storyItem(b)], [8], 3);
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
    const rows = buildBacklogRows([storyItem(a), storyItem(b), iterationBreakItem("brk"), storyItem(c)], [8], 3);
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
    const rows = buildBacklogRows([iterationBreakItem("brk"), storyItem(a)], [8], 3);
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
      [1],
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
    const rows = buildBacklogRows([storyItem(a), iterationBreakItem("brk")], [8], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 1, manualBreakDividerId: undefined },
      { kind: "story", story: a },
      { kind: "iteration-break", divider: { id: "brk", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 4, points: 0, manualBreakDividerId: "brk" },
    ]);
  });

  it("consecutive manual breaks each still get their own (empty) header, each stamped with its own break's id", () => {
    const rows = buildBacklogRows([iterationBreakItem("brk1"), iterationBreakItem("brk2")], [8], 3);
    expect(rows).toEqual([
      { kind: "iteration-header", number: 3, points: 0, manualBreakDividerId: undefined },
      { kind: "iteration-break", divider: { id: "brk1", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 4, points: 0, manualBreakDividerId: "brk1" },
      { kind: "iteration-break", divider: { id: "brk2", label: "", kind: "iteration_break" } },
      { kind: "iteration-header", number: 5, points: 0, manualBreakDividerId: "brk2" },
    ]);
  });
});

describe("nextRealRowId", () => {
  it("returns null when nothing real follows", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a)], [100], 3);
    expect(nextRealRowId(rows, 2)).toBeNull();
  });

  it("skips over a header row to the next real row", () => {
    const a = { id: "a", points: 5, story_type: "feature" };
    const b = { id: "b", points: 5, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), storyItem(b)], [8], 3);
    // rows: [header#3, story a, header#4, story b] — starting right after
    // story a (index 2, the header) must skip it and land on story b.
    expect(nextRealRowId(rows, 2)).toBe("story:b");
  });

  it("does not skip a manual break — it's the next real row itself", () => {
    const a = { id: "a", points: 1, story_type: "feature" };
    const b = { id: "b", points: 1, story_type: "feature" };
    const rows = buildBacklogRows([storyItem(a), iterationBreakItem("brk"), storyItem(b)], [8], 3);
    // rows: [header#3, story a, break, header#4, story b] — starting right
    // after story a (index 2, the break itself) must resolve to the break,
    // not skip past it into the next group.
    expect(nextRealRowId(rows, 2)).toBe("divider:brk");
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

describe("buildBacklogRows budgets", () => {
  const story = (id: string, points: number): BacklogRowItem<Story> => ({
    kind: "story",
    story: { id, points, story_type: "feature" },
  });

  it("gives each group its own budget, in order", () => {
    // Sprint 3 has 5 points of capacity, sprint 4 only 2 (a holiday week).
    const rows = buildBacklogRows([story("a", 3), story("b", 2), story("c", 2)], [5, 2], 3);
    expect(rows.filter((r) => r.kind === "iteration-header")).toEqual([
      { kind: "iteration-header", number: 3, points: 5, manualBreakDividerId: undefined },
      { kind: "iteration-header", number: 4, points: 2, manualBreakDividerId: undefined },
    ]);
  });

  it("repeats the last budget once the backlog outruns the projected sprints", () => {
    const rows = buildBacklogRows([story("a", 2), story("b", 2), story("c", 2)], [2], 3);
    expect(rows.filter((r) => r.kind === "iteration-header").map((r) => r.number)).toEqual([3, 4, 5]);
  });

  it("falls back to 1 point per group when no budgets exist yet", () => {
    const rows = buildBacklogRows([story("a", 1), story("b", 1)], [], 3);
    expect(rows.filter((r) => r.kind === "iteration-header").map((r) => r.number)).toEqual([3, 4]);
  });

  it("floors a zero budget at 1 point rather than giving every story its own group", () => {
    const rows = buildBacklogRows([story("a", 1), story("b", 1)], [0], 3);
    expect(rows.filter((r) => r.kind === "iteration-header").map((r) => r.number)).toEqual([3, 4]);
  });

  it("gives a single oversized story its own group", () => {
    const rows = buildBacklogRows([story("a", 13), story("b", 2)], [5, 5], 3);
    expect(rows.filter((r) => r.kind === "iteration-header")).toEqual([
      { kind: "iteration-header", number: 3, points: 13, manualBreakDividerId: undefined },
      { kind: "iteration-header", number: 4, points: 2, manualBreakDividerId: undefined },
    ]);
  });

  it("never breaks a group on a chore/release/unestimated story since they cost 0", () => {
    const items: BacklogRowItem<Story>[] = [
      story("a", 3),
      { kind: "story", story: { id: "b", points: null, story_type: "chore" } },
      { kind: "story", story: { id: "c", points: null, story_type: "release" } },
      story("d", 5),
    ];
    const rows = buildBacklogRows(items, [8], 3);
    expect(rows.filter((r) => r.kind === "iteration-header")).toHaveLength(1);
  });

  it("advances the budget across a manual break too", () => {
    const rows = buildBacklogRows([story("a", 1), iterationBreakItem("brk"), story("b", 2), story("c", 2)], [10, 2], 3);
    // The break closes group 0, so `b` and `c` are budgeted against the
    // second sprint's 2 points and cannot share a group.
    expect(rows.filter((r) => r.kind === "iteration-header").map((r) => r.number)).toEqual([3, 4, 5]);
  });
});

describe("iterationLabel", () => {
  it("uses the project's own term instead of \"Iteration\"", () => {
    expect(iterationLabel("Sprint", 7, 14, "2026-07-20")).toBe("Sprint #7");
  });

  it("titles a 1-day iteration by its date, where the number says nothing", () => {
    expect(iterationLabel("Sprint", 137, 1, "2026-07-20")).toBe("2026/7/20");
  });

  it("falls back to the number when a 1-day iteration has no date yet", () => {
    expect(iterationLabel("Sprint", 137, 1)).toBe("Sprint #137");
  });
});

describe("iterationSpanLabel", () => {
  it("names the week count when the span lands on a whole number of weeks", () => {
    expect(iterationSpanLabel("2026-07-06", "2026-07-26")).toBe("21 days (3 weeks)");
    expect(iterationSpanLabel("2026-07-06", "2026-07-12")).toBe("7 days (1 week)");
  });

  it("reports plain days otherwise", () => {
    expect(iterationSpanLabel("2026-07-06", "2026-07-22")).toBe("17 days");
    expect(iterationSpanLabel("2026-07-06", "2026-07-06")).toBe("1 day");
  });

  it("is empty for a backwards range, which the picker never commits", () => {
    expect(iterationSpanLabel("2026-07-06", "2026-07-01")).toBe("");
  });
});

describe("projectedIterationDates at a 1-day cadence", () => {
  // Mon-Fri project. Without the working-day rule these projections land on
  // Sat/Sun, which no real iteration ever occupies — and IterationHeaderRow
  // titles 1-day groups by exactly this date.
  const MON_FRI = [1, 2, 3, 4, 5];

  it("skips the weekend and covers it from Friday", () => {
    // Current iteration ends Thu 2026-07-16 → next is Fri 17th, spanning Fri-Sun.
    expect(projectedIterationDates("2026-07-16", 1, 1, MON_FRI)).toEqual({
      start_date: "2026-07-17",
      end_date: "2026-07-19",
    });
    // The one after it is Mon 20th, a single day.
    expect(projectedIterationDates("2026-07-16", 1, 2, MON_FRI)).toEqual({
      start_date: "2026-07-20",
      end_date: "2026-07-20",
    });
  });

  it("leaves longer cadences on plain arithmetic", () => {
    expect(projectedIterationDates("2026-07-16", 14, 1, MON_FRI)).toEqual({
      start_date: "2026-07-17",
      end_date: "2026-07-30",
    });
  });
});
