import { describe, expect, it } from "vitest";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  columnForStory,
  evaluateDrop,
  evaluateListDrop,
  flattenCurrentZone,
  zoneForStory,
  type KanbanStory,
} from "./kanban";

const CURRENT = "iter-1";

function story(overrides: Partial<KanbanStory> = {}): KanbanStory {
  return { state: "unstarted", story_type: "feature", points: 2, iteration_id: null, ...overrides };
}

describe("columnForStory", () => {
  it("puts unscheduled stories in the icebox regardless of iteration", () => {
    expect(columnForStory(story({ state: "unscheduled" }), CURRENT)).toBe(ICEBOX_COLUMN_ID);
  });

  it("puts current-iteration stories in their state column", () => {
    expect(columnForStory(story({ state: "started", iteration_id: CURRENT }), CURRENT)).toBe("started");
  });

  it("puts stories without an iteration in the backlog", () => {
    expect(columnForStory(story(), CURRENT)).toBe(BACKLOG_COLUMN_ID);
  });

  it("puts stories of another (non-current) iteration in the backlog", () => {
    expect(columnForStory(story({ iteration_id: "iter-9" }), CURRENT)).toBe(BACKLOG_COLUMN_ID);
  });
});

describe("evaluateDrop", () => {
  it("treats a same-column drop as a reorder", () => {
    const result = evaluateDrop(story(), BACKLOG_COLUMN_ID, BACKLOG_COLUMN_ID);
    expect(result).toEqual({ ok: true, iteration: "keep" });
  });

  it("schedules a backlog story dropped on Unstarted into the current iteration", () => {
    const result = evaluateDrop(story(), BACKLOG_COLUMN_ID, "unstarted");
    expect(result).toEqual({ ok: true, iteration: "current" });
  });

  it("assigns and starts a backlog story dropped on Started in one gesture", () => {
    const result = evaluateDrop(story(), BACKLOG_COLUMN_ID, "started");
    expect(result).toEqual({ ok: true, state: "started", iteration: "current" });
  });

  it("rejects a backlog story dropped past Started", () => {
    expect(evaluateDrop(story(), BACKLOG_COLUMN_ID, "finished").ok).toBe(false);
    expect(evaluateDrop(story(), BACKLOG_COLUMN_ID, "accepted").ok).toBe(false);
  });

  it("blocks starting an unestimated feature (drag equivalent of the Start guard)", () => {
    const unestimated = story({ points: null });
    expect(evaluateDrop(unestimated, BACKLOG_COLUMN_ID, "started").ok).toBe(false);
    expect(evaluateDrop(unestimated, "unstarted", "started").ok).toBe(false);
    // A chore has no points and is never blocked by the estimate rule.
    expect(evaluateDrop(story({ story_type: "chore", points: null }), "unstarted", "started").ok).toBe(true);
  });

  it("allows only one-step forward transitions between state columns", () => {
    expect(evaluateDrop(story({ state: "unstarted", iteration_id: CURRENT }), "unstarted", "started")).toEqual({
      ok: true,
      state: "started",
      iteration: "keep",
    });
    expect(evaluateDrop(story({ state: "started", iteration_id: CURRENT }), "started", "finished").ok).toBe(true);
    expect(evaluateDrop(story({ state: "finished", iteration_id: CURRENT }), "finished", "delivered").ok).toBe(true);
    expect(evaluateDrop(story({ state: "delivered", iteration_id: CURRENT }), "delivered", "accepted").ok).toBe(true);
    expect(evaluateDrop(story({ state: "delivered", iteration_id: CURRENT }), "delivered", "rejected").ok).toBe(true);
    // Skips and backward moves are rejected.
    expect(evaluateDrop(story({ state: "unstarted", iteration_id: CURRENT }), "unstarted", "finished").ok).toBe(false);
    expect(evaluateDrop(story({ state: "finished", iteration_id: CURRENT }), "finished", "started").ok).toBe(false);
    expect(evaluateDrop(story({ state: "accepted", iteration_id: CURRENT }), "accepted", "delivered").ok).toBe(false);
  });

  it("restarts a rejected story dropped on Started", () => {
    const result = evaluateDrop(story({ state: "rejected", iteration_id: CURRENT }), "rejected", "started");
    expect(result).toEqual({ ok: true, state: "started", iteration: "keep" });
  });

  it("promotes an icebox story to the backlog or into the current iteration", () => {
    expect(evaluateDrop(story({ state: "unscheduled" }), ICEBOX_COLUMN_ID, BACKLOG_COLUMN_ID)).toEqual({
      ok: true,
      state: "unstarted",
      iteration: "none",
    });
    expect(evaluateDrop(story({ state: "unscheduled" }), ICEBOX_COLUMN_ID, "unstarted")).toEqual({
      ok: true,
      state: "unstarted",
      iteration: "current",
    });
    expect(evaluateDrop(story({ state: "unscheduled" }), ICEBOX_COLUMN_ID, "started").ok).toBe(false);
  });

  it("demotes only unstarted work to the icebox", () => {
    expect(evaluateDrop(story(), BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID)).toEqual({
      ok: true,
      state: "unscheduled",
      iteration: "none",
    });
    expect(evaluateDrop(story({ iteration_id: CURRENT }), "unstarted", ICEBOX_COLUMN_ID).ok).toBe(true);
    expect(evaluateDrop(story({ state: "started", iteration_id: CURRENT }), "started", ICEBOX_COLUMN_ID).ok).toBe(false);
  });

  // TASK-19: a story stuck `started` with no iteration (the Start-button bug)
  // still lands in the Backlog column (columnForStory falls through to it
  // whenever iteration_id doesn't match current) — demoting to the Icebox
  // must be rejected on the story's actual state, not just because its
  // *origin* column happens to be Backlog, or this silently discards its
  // in-progress work.
  it("rejects demoting a started-but-backlog-column story to the icebox", () => {
    const stuck = story({ state: "started", iteration_id: null });
    expect(evaluateDrop(stuck, BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID).ok).toBe(false);
  });

  it("un-schedules an unstarted story dragged back to the backlog", () => {
    const result = evaluateDrop(story({ iteration_id: CURRENT }), "unstarted", BACKLOG_COLUMN_ID);
    expect(result).toEqual({ ok: true, iteration: "none" });
    expect(evaluateDrop(story({ state: "started", iteration_id: CURRENT }), "started", BACKLOG_COLUMN_ID).ok).toBe(false);
  });
});

describe("zoneForStory", () => {
  it("puts unscheduled stories in the icebox regardless of iteration", () => {
    expect(zoneForStory(story({ state: "unscheduled" }), CURRENT)).toBe(ICEBOX_COLUMN_ID);
  });

  it("puts any current-iteration state in the current zone", () => {
    expect(zoneForStory(story({ state: "started", iteration_id: CURRENT }), CURRENT)).toBe("current");
    expect(zoneForStory(story({ state: "accepted", iteration_id: CURRENT }), CURRENT)).toBe("current");
  });

  it("puts stories without an iteration, or of another iteration, in the backlog", () => {
    expect(zoneForStory(story(), CURRENT)).toBe(BACKLOG_COLUMN_ID);
    expect(zoneForStory(story({ iteration_id: "iter-9" }), CURRENT)).toBe(BACKLOG_COLUMN_ID);
  });
});

describe("evaluateListDrop", () => {
  it("treats a same-zone drop as a reorder regardless of state", () => {
    expect(evaluateListDrop(story(), "current", "current")).toEqual({ ok: true, iteration: "keep" });
    expect(
      evaluateListDrop(story({ state: "started", iteration_id: CURRENT }), "current", "current"),
    ).toEqual({ ok: true, iteration: "keep" });
  });

  it("schedules a backlog story dropped into the current zone as unstarted", () => {
    expect(evaluateListDrop(story(), BACKLOG_COLUMN_ID, "current")).toEqual({ ok: true, iteration: "current" });
  });

  it("un-schedules only an unstarted current-zone story back to the backlog", () => {
    expect(evaluateListDrop(story({ iteration_id: CURRENT }), "current", BACKLOG_COLUMN_ID)).toEqual({
      ok: true,
      iteration: "none",
    });
    expect(
      evaluateListDrop(story({ state: "started", iteration_id: CURRENT }), "current", BACKLOG_COLUMN_ID).ok,
    ).toBe(false);
  });

  it("promotes an icebox story to the backlog or into the current zone", () => {
    expect(evaluateListDrop(story({ state: "unscheduled" }), ICEBOX_COLUMN_ID, BACKLOG_COLUMN_ID)).toEqual({
      ok: true,
      state: "unstarted",
      iteration: "none",
    });
    expect(evaluateListDrop(story({ state: "unscheduled" }), ICEBOX_COLUMN_ID, "current")).toEqual({
      ok: true,
      state: "unstarted",
      iteration: "current",
    });
  });

  it("demotes only an unstarted story to the icebox", () => {
    expect(evaluateListDrop(story(), BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID)).toEqual({
      ok: true,
      state: "unscheduled",
      iteration: "none",
    });
    expect(evaluateListDrop(story({ iteration_id: CURRENT }), "current", ICEBOX_COLUMN_ID).ok).toBe(true);
    expect(
      evaluateListDrop(story({ state: "started", iteration_id: CURRENT }), "current", ICEBOX_COLUMN_ID).ok,
    ).toBe(false);
  });

  // TASK-19: same bug as evaluateDrop's — a story stuck `started` with no
  // iteration lands in the Backlog *zone* too (zoneForStory falls through
  // to it whenever iteration_id doesn't match current).
  it("rejects demoting a started-but-backlog-zone story to the icebox", () => {
    const stuck = story({ state: "started", iteration_id: null });
    expect(evaluateListDrop(stuck, BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID).ok).toBe(false);
  });
});

describe("flattenCurrentZone", () => {
  it("merges state-column buckets into one list ordered by position, not by state", () => {
    // A started story at position 0 must render above an unstarted story at
    // position 1 (TASK-21) — concatenating state buckets in board order
    // (unstarted, started, ...) would wrongly put the unstarted one first.
    const containers = {
      unstarted: [{ id: "b", position: 1 }],
      started: [{ id: "a", position: 0 }],
      finished: [{ id: "c", position: 2 }],
    };
    expect(flattenCurrentZone(containers).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list when every bucket is empty", () => {
    expect(flattenCurrentZone({})).toEqual([]);
  });
});
