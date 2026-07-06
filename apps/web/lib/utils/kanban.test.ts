import { describe, expect, it } from "vitest";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  columnForStory,
  evaluateDrop,
  groupByStateColumn,
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

  it("un-schedules an unstarted story dragged back to the backlog", () => {
    const result = evaluateDrop(story({ iteration_id: CURRENT }), "unstarted", BACKLOG_COLUMN_ID);
    expect(result).toEqual({ ok: true, iteration: "none" });
    expect(evaluateDrop(story({ state: "started", iteration_id: CURRENT }), "started", BACKLOG_COLUMN_ID).ok).toBe(false);
  });
});

describe("groupByStateColumn", () => {
  it("buckets stories by state preserving order and fills empty columns", () => {
    const grouped = groupByStateColumn([
      { state: "started", id: "a" },
      { state: "unstarted", id: "b" },
      { state: "started", id: "c" },
    ]);
    expect(grouped.started.map((s) => s.id)).toEqual(["a", "c"]);
    expect(grouped.unstarted.map((s) => s.id)).toEqual(["b"]);
    expect(grouped.accepted).toEqual([]);
  });

  it("ignores stories whose state has no column (unscheduled)", () => {
    const grouped = groupByStateColumn([{ state: "unscheduled", id: "x" }]);
    expect(Object.values(grouped).flat()).toEqual([]);
  });
});
