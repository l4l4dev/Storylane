import { describe, expect, it } from "vitest";
import type { GateState } from "@storylane/core";
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
import stateTemplates from "../../../../spec/fixtures/state-templates.json";
import type { ProjectState } from "@/lib/types";

const CURRENT = "iter-1";

// Classic-template states, keyed by name (ids are runtime UUIDs; this test
// synthesizes stable ids by reusing the name — same pattern as
// packages/core/src/story-state.test.ts).
function toGateStates(states: { name: string; category: string; actionLabel: string | null; position: number }[]): GateState[] {
  return states.map((s) => ({ id: s.name, category: s.category as GateState["category"], actionLabel: s.actionLabel, position: s.position }));
}

const STATES: GateState[] = toGateStates(stateTemplates.classic.states);

function story(overrides: Partial<KanbanStory> = {}): KanbanStory {
  return { state_id: "Unstarted", story_type: "feature", points: 2, iteration_id: null, ...overrides };
}

describe("columnForStory", () => {
  it("puts Icebox stories (state_id null) in the icebox regardless of iteration", () => {
    expect(columnForStory(story({ state_id: null }), CURRENT)).toBe(ICEBOX_COLUMN_ID);
  });

  it("puts current-iteration stories in their state column", () => {
    expect(columnForStory(story({ state_id: "Started", iteration_id: CURRENT }), CURRENT)).toBe("Started");
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
    const result = evaluateDrop(story(), BACKLOG_COLUMN_ID, BACKLOG_COLUMN_ID, STATES);
    expect(result).toEqual({ ok: true, iteration: "keep" });
  });

  it("schedules a backlog story dropped on Unstarted into the current iteration", () => {
    const result = evaluateDrop(story(), BACKLOG_COLUMN_ID, "Unstarted", STATES);
    expect(result).toEqual({ ok: true, iteration: "current" });
  });

  it("assigns and starts a backlog story dropped on Started in one gesture", () => {
    const result = evaluateDrop(story(), BACKLOG_COLUMN_ID, "Started", STATES);
    expect(result).toEqual({ ok: true, state_id: "Started", iteration: "current" });
  });

  it("rejects a backlog story dropped past Started", () => {
    expect(evaluateDrop(story(), BACKLOG_COLUMN_ID, "Finished", STATES).ok).toBe(false);
    expect(evaluateDrop(story(), BACKLOG_COLUMN_ID, "Accepted", STATES).ok).toBe(false);
  });

  it("blocks starting an unestimated feature (drag equivalent of the Start guard)", () => {
    const unestimated = story({ points: null });
    expect(evaluateDrop(unestimated, BACKLOG_COLUMN_ID, "Started", STATES).ok).toBe(false);
    expect(evaluateDrop(unestimated, "Unstarted", "Started", STATES).ok).toBe(false);
    // A chore has no points and is never blocked by the estimate rule.
    expect(evaluateDrop(story({ story_type: "chore", points: null }), "Unstarted", "Started", STATES).ok).toBe(true);
  });

  it("allows any state-column-to-state-column drop, including skips and backward moves (spec/screens.md 'Drag = set state')", () => {
    expect(
      evaluateDrop(story({ state_id: "Unstarted", iteration_id: CURRENT }), "Unstarted", "Started", STATES),
    ).toEqual({ ok: true, state_id: "Started", iteration: "keep" });
    expect(
      evaluateDrop(story({ state_id: "Started", iteration_id: CURRENT }), "Started", "Finished", STATES).ok,
    ).toBe(true);
    expect(
      evaluateDrop(story({ state_id: "Delivered", iteration_id: CURRENT }), "Delivered", "Accepted", STATES).ok,
    ).toBe(true);
    expect(
      evaluateDrop(story({ state_id: "Delivered", iteration_id: CURRENT }), "Delivered", "Rejected", STATES).ok,
    ).toBe(true);
    // Skips and backward moves are the ordering the advance button (not the
    // drop) enforces — the drop itself allows any -> any.
    expect(
      evaluateDrop(story({ state_id: "Unstarted", iteration_id: CURRENT }), "Unstarted", "Finished", STATES).ok,
    ).toBe(true);
    expect(
      evaluateDrop(story({ state_id: "Finished", iteration_id: CURRENT }), "Finished", "Started", STATES).ok,
    ).toBe(true);
    expect(
      evaluateDrop(story({ state_id: "Accepted", iteration_id: CURRENT }), "Accepted", "Delivered", STATES).ok,
    ).toBe(true);
  });

  it("still blocks an unestimated feature from an arbitrary far drop, same as an adjacent one", () => {
    const unestimated = story({ state_id: "Unstarted", iteration_id: CURRENT, points: null });
    expect(evaluateDrop(unestimated, "Unstarted", "Accepted", STATES).ok).toBe(false);
  });

  it("restarts a rejected story dropped on Started", () => {
    const result = evaluateDrop(story({ state_id: "Rejected", iteration_id: CURRENT }), "Rejected", "Started", STATES);
    expect(result).toEqual({ ok: true, state_id: "Started", iteration: "keep" });
  });

  it("promotes an icebox story to the backlog or into the current iteration", () => {
    expect(evaluateDrop(story({ state_id: null }), ICEBOX_COLUMN_ID, BACKLOG_COLUMN_ID, STATES)).toEqual({
      ok: true,
      state_id: "Unstarted",
      iteration: "none",
    });
    expect(evaluateDrop(story({ state_id: null }), ICEBOX_COLUMN_ID, "Unstarted", STATES)).toEqual({
      ok: true,
      state_id: "Unstarted",
      iteration: "current",
    });
    expect(evaluateDrop(story({ state_id: null }), ICEBOX_COLUMN_ID, "Started", STATES).ok).toBe(false);
  });

  it("demotes only unstarted work to the icebox", () => {
    expect(evaluateDrop(story(), BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID, STATES)).toEqual({
      ok: true,
      state_id: null,
      iteration: "none",
    });
    expect(evaluateDrop(story({ iteration_id: CURRENT }), "Unstarted", ICEBOX_COLUMN_ID, STATES).ok).toBe(true);
    expect(
      evaluateDrop(story({ state_id: "Started", iteration_id: CURRENT }), "Started", ICEBOX_COLUMN_ID, STATES).ok,
    ).toBe(false);
  });

  // TASK-19: a story stuck `started` with no iteration (the Start-button bug)
  // still lands in the Backlog column (columnForStory falls through to it
  // whenever iteration_id doesn't match current) — demoting to the Icebox
  // must be rejected on the story's actual state, not just because its
  // *origin* column happens to be Backlog, or this silently discards its
  // in-progress work.
  it("rejects demoting a started-but-backlog-column story to the icebox", () => {
    const stuck = story({ state_id: "Started", iteration_id: null });
    expect(evaluateDrop(stuck, BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID, STATES).ok).toBe(false);
  });

  it("un-schedules an unstarted story dragged back to the backlog", () => {
    const result = evaluateDrop(story({ iteration_id: CURRENT }), "Unstarted", BACKLOG_COLUMN_ID, STATES);
    expect(result).toEqual({ ok: true, iteration: "none" });
    expect(
      evaluateDrop(story({ state_id: "Started", iteration_id: CURRENT }), "Started", BACKLOG_COLUMN_ID, STATES).ok,
    ).toBe(false);
  });

  it("rejects an unknown target column", () => {
    expect(evaluateDrop(story({ iteration_id: CURRENT }), "Unstarted", "not-a-real-state", STATES).ok).toBe(false);
  });

  it("generalizes to a project with no rejected-category state (minimal template)", () => {
    const minimal: GateState[] = toGateStates(stateTemplates.minimal.states);
    // Doing -> Done is the only gate-offered target; Doing has no reject target to drop onto.
    expect(
      evaluateDrop(story({ state_id: "Doing", iteration_id: CURRENT, points: 2 }), "Doing", "Done", minimal).ok,
    ).toBe(true);
  });
});

describe("zoneForStory", () => {
  it("puts Icebox stories (state_id null) in the icebox regardless of iteration", () => {
    expect(zoneForStory(story({ state_id: null }), CURRENT)).toBe(ICEBOX_COLUMN_ID);
  });

  it("puts any current-iteration state in the current zone", () => {
    expect(zoneForStory(story({ state_id: "Started", iteration_id: CURRENT }), CURRENT)).toBe("current");
    expect(zoneForStory(story({ state_id: "Accepted", iteration_id: CURRENT }), CURRENT)).toBe("current");
  });

  it("puts stories without an iteration, or of another iteration, in the backlog", () => {
    expect(zoneForStory(story(), CURRENT)).toBe(BACKLOG_COLUMN_ID);
    expect(zoneForStory(story({ iteration_id: "iter-9" }), CURRENT)).toBe(BACKLOG_COLUMN_ID);
  });
});

describe("evaluateListDrop", () => {
  it("treats a same-zone drop as a reorder regardless of state", () => {
    expect(evaluateListDrop(story(), "current", "current", STATES)).toEqual({ ok: true, iteration: "keep" });
    expect(
      evaluateListDrop(story({ state_id: "Started", iteration_id: CURRENT }), "current", "current", STATES),
    ).toEqual({ ok: true, iteration: "keep" });
  });

  it("schedules a backlog story dropped into the current zone as unstarted", () => {
    expect(evaluateListDrop(story(), BACKLOG_COLUMN_ID, "current", STATES)).toEqual({ ok: true, iteration: "current" });
  });

  it("un-schedules only an unstarted current-zone story back to the backlog", () => {
    expect(evaluateListDrop(story({ iteration_id: CURRENT }), "current", BACKLOG_COLUMN_ID, STATES)).toEqual({
      ok: true,
      iteration: "none",
    });
    expect(
      evaluateListDrop(story({ state_id: "Started", iteration_id: CURRENT }), "current", BACKLOG_COLUMN_ID, STATES).ok,
    ).toBe(false);
  });

  it("promotes an icebox story to the backlog or into the current zone", () => {
    expect(evaluateListDrop(story({ state_id: null }), ICEBOX_COLUMN_ID, BACKLOG_COLUMN_ID, STATES)).toEqual({
      ok: true,
      state_id: "Unstarted",
      iteration: "none",
    });
    expect(evaluateListDrop(story({ state_id: null }), ICEBOX_COLUMN_ID, "current", STATES)).toEqual({
      ok: true,
      state_id: "Unstarted",
      iteration: "current",
    });
  });

  it("demotes only an unstarted story to the icebox", () => {
    expect(evaluateListDrop(story(), BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID, STATES)).toEqual({
      ok: true,
      state_id: null,
      iteration: "none",
    });
    expect(evaluateListDrop(story({ iteration_id: CURRENT }), "current", ICEBOX_COLUMN_ID, STATES).ok).toBe(true);
    expect(
      evaluateListDrop(story({ state_id: "Started", iteration_id: CURRENT }), "current", ICEBOX_COLUMN_ID, STATES).ok,
    ).toBe(false);
  });

  // TASK-19: same bug as evaluateDrop's — a story stuck `started` with no
  // iteration lands in the Backlog *zone* too (zoneForStory falls through
  // to it whenever iteration_id doesn't match current).
  it("rejects demoting a started-but-backlog-zone story to the icebox", () => {
    const stuck = story({ state_id: "Started", iteration_id: null });
    expect(evaluateListDrop(stuck, BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID, STATES).ok).toBe(false);
  });
});

describe("flattenCurrentZone", () => {
  it("merges state-column buckets into one list ordered by position, not by state", () => {
    // A started story at position 0 must render above an unstarted story at
    // position 1 (TASK-21) — concatenating state buckets in board order
    // (Unstarted, Started, ...) would wrongly put the unstarted one first.
    const containers = {
      Unstarted: [{ id: "b", position: 1 }],
      Started: [{ id: "a", position: 0 }],
      Finished: [{ id: "c", position: 2 }],
    };
    const projectStates: ProjectState[] = stateTemplates.classic.states.map((s) => ({
      id: s.name,
      name: s.name,
      category: s.category as ProjectState["category"],
      action_label: s.actionLabel,
      position: s.position,
      project_id: "p1",
      created_at: "",
    }));
    expect(flattenCurrentZone(containers, projectStates).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("interleaves columns by one iteration-wide position sequence (TASK-111)", () => {
    // With a single iteration-scoped sequence (what move_story_board now
    // writes), a column's stories carry non-contiguous global positions and
    // must interleave with other columns by position — Started 0/2/4 and
    // Finished 1/3 flatten to a strict 0..4 order, not column-grouped.
    const containers = {
      Unstarted: [] as { id: string; position: number }[],
      Started: [
        { id: "s0", position: 0 },
        { id: "s2", position: 2 },
        { id: "s4", position: 4 },
      ],
      Finished: [
        { id: "f1", position: 1 },
        { id: "f3", position: 3 },
      ],
    };
    const projectStates: ProjectState[] = stateTemplates.classic.states.map((s) => ({
      id: s.name,
      name: s.name,
      category: s.category as ProjectState["category"],
      action_label: s.actionLabel,
      position: s.position,
      project_id: "p1",
      created_at: "",
    }));
    expect(flattenCurrentZone(containers, projectStates).map((s) => s.id)).toEqual([
      "s0",
      "f1",
      "s2",
      "f3",
      "s4",
    ]);
  });

  it("returns an empty list when every bucket is empty", () => {
    expect(flattenCurrentZone({}, [])).toEqual([]);
  });
});
