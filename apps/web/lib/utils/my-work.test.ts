import { describe, expect, it } from "vitest";
import {
  canDropOnDone,
  classifyMyWork,
  groupDoneByDate,
  isManualOrderReorder,
  regroupByProject,
  resolveColumnNames,
  resolveColumnOrder,
  resolveDragEndTarget,
  toDragContainers,
  type DoneEntry,
  type MyWorkColumns,
  type MyWorkDragItem,
  type MyWorkFreeColumn,
  type MyWorkProject,
  type MyWorkStory,
} from "./my-work";

const TODAY = "2026-07-22";
const PERSONAL: MyWorkProject = { id: "personal", name: "Owner's tasks", isPersonal: true };
const TEAM_A: MyWorkProject = { id: "team-a", name: "Alpha", isPersonal: false };
const TEAM_B: MyWorkProject = { id: "team-b", name: "Bravo", isPersonal: false };
const DOING: MyWorkFreeColumn = { id: "doing", name: "Doing", position: 0 };
const WAITING: MyWorkFreeColumn = { id: "waiting", name: "Waiting", position: 1 };

// Each story's `row` is just its id here — classification never inspects it.
function story(overrides: Partial<MyWorkStory<string>> & { id: string; projectId: string }): MyWorkStory<string> {
  return { position: 0, todayDate: null, todayPosition: null, columnId: null, columnPosition: null, row: overrides.id, ...overrides };
}

function completion(id: string, completedAt: string): DoneEntry<string> {
  return { completedAt, row: id };
}

describe("classifyMyWork", () => {
  it("places by precedence: Today (today_date) > free column (column_id) > Todo", () => {
    const { todo, today, free } = classifyMyWork(
      [
        story({ id: "backlog", projectId: "team-a" }),
        story({ id: "inDoing", projectId: "team-a", columnId: "doing" }),
        story({ id: "planned", projectId: "team-a", todayDate: TODAY }),
      ],
      [],
      [TEAM_A],
      [DOING],
      TODAY,
    );
    expect(todo.flatMap((g) => g.stories.map((s) => s.id))).toEqual(["backlog"]);
    expect(today.map((s) => s.id)).toEqual(["planned"]);
    expect(free[0].stories.map((s) => s.id)).toEqual(["inDoing"]);
  });

  it("a Today mark from a past day falls back to its column (not shown in Today)", () => {
    const { today, free, todo } = classifyMyWork(
      [
        story({ id: "staleInDoing", projectId: "team-a", todayDate: "2020-01-01", columnId: "doing" }),
        story({ id: "staleBacklog", projectId: "team-a", todayDate: "2020-01-01" }),
      ],
      [],
      [TEAM_A],
      [DOING],
      TODAY,
    );
    expect(today).toEqual([]);
    expect(free[0].stories.map((s) => s.id)).toEqual(["staleInDoing"]);
    expect(todo.flatMap((g) => g.stories.map((s) => s.id))).toEqual(["staleBacklog"]);
  });

  it("a card whose column was deleted (column_id null / unknown) falls to Todo", () => {
    const { todo, free } = classifyMyWork(
      [story({ id: "orphan", projectId: "team-a", columnId: "gone" })],
      [],
      [TEAM_A],
      [DOING],
      TODAY,
    );
    expect(free[0].stories).toEqual([]);
    expect(todo.flatMap((g) => g.stories.map((s) => s.id))).toEqual(["orphan"]);
  });

  it("orders free columns by position and Today by today_position (nulls last)", () => {
    const { today, free } = classifyMyWork(
      [
        story({ id: "t-late", projectId: "team-a", todayDate: TODAY, todayPosition: 5 }),
        story({ id: "t-none", projectId: "team-a", todayDate: TODAY, todayPosition: null }),
        story({ id: "t-early", projectId: "team-a", todayDate: TODAY, todayPosition: 1 }),
        story({ id: "w", projectId: "team-a", columnId: "waiting" }),
        story({ id: "d", projectId: "team-a", columnId: "doing" }),
      ],
      [],
      [TEAM_A],
      [WAITING, DOING], // deliberately unsorted input
      TODAY,
    );
    expect(today.map((s) => s.id)).toEqual(["t-early", "t-late", "t-none"]);
    expect(free.map((f) => f.column.id)).toEqual(["doing", "waiting"]); // sorted by position
  });

  // TASK-150: a free column's own cards are manually ordered by
  // column_position, the same nulls-last shape as Today's today_position.
  it("orders cards within a free column by column_position (nulls last)", () => {
    const { free } = classifyMyWork(
      [
        story({ id: "d-late", projectId: "team-a", columnId: "doing", columnPosition: 5 }),
        story({ id: "d-none", projectId: "team-a", columnId: "doing", columnPosition: null }),
        story({ id: "d-early", projectId: "team-a", columnId: "doing", columnPosition: 1 }),
      ],
      [],
      [TEAM_A],
      [DOING],
      TODAY,
    );
    expect(free[0].stories.map((s) => s.id)).toEqual(["d-early", "d-late", "d-none"]);
  });

  it("groups Todo by project, personal-first then name, position within group", () => {
    const { todo } = classifyMyWork(
      [
        story({ id: "b2", projectId: "team-b", position: 2 }),
        story({ id: "b1", projectId: "team-b", position: 1 }),
        story({ id: "a1", projectId: "team-a" }),
        story({ id: "p1", projectId: "personal" }),
      ],
      [],
      [TEAM_B, TEAM_A, PERSONAL],
      [],
      TODAY,
    );
    expect(todo.map((g) => g.projectId)).toEqual(["personal", "team-a", "team-b"]);
    expect(todo[2].stories.map((s) => s.id)).toEqual(["b1", "b2"]);
  });

  // doc-17 #40: a project the caller couldn't resolve (e.g. the viewer left
  // it) reads as an expected state, not an error.
  it("labels a group whose project can't be resolved as 'Left project', not an error", () => {
    const { todo } = classifyMyWork([story({ id: "g1", projectId: "gone" })], [], [TEAM_A], [], TODAY);
    expect(todo.find((g) => g.projectId === "gone")?.projectName).toBe("Left project");
  });

  it("Done = completion rows (incl. one per repeat) live-joined, newest first", () => {
    const { done } = classifyMyWork(
      [],
      [completion("s", "2026-07-20T09:00:00Z"), completion("s", "2026-07-21T09:00:00Z")],
      [TEAM_A],
      [],
      TODAY,
    );
    const groups = groupDoneByDate(done);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-07-21", "2026-07-20"]);
    expect(done).toHaveLength(2);
  });

  it("a past completion + a current active card shows in BOTH Done and its column", () => {
    const { done, free } = classifyMyWork(
      [story({ id: "s", projectId: "team-a", columnId: "doing" })],
      [completion("s", "2026-07-19T09:00:00Z")],
      [TEAM_A],
      [DOING],
      TODAY,
    );
    expect(free[0].stories.map((s) => s.id)).toEqual(["s"]);
    expect(done.map((d) => d.row)).toEqual(["s"]);
  });
});

// TASK-132: drag-container helpers need a row shape with id/projectId/projectName.
type Row = { id: string; projectId: string; projectName: string };
function rowShape(id: string, projectId: string, projectName: string): Row {
  return { id, projectId, projectName };
}
function dragStory(id: string, projectId: string, projectName: string): MyWorkStory<Row> {
  return {
    id,
    projectId,
    position: 0,
    todayDate: null,
    todayPosition: null,
    columnId: null,
    columnPosition: null,
    row: rowShape(id, projectId, projectName),
  };
}

describe("toDragContainers", () => {
  it("keys structural + free columns, giving active cards the bare story id", () => {
    const columns: MyWorkColumns<Row> = {
      todo: [{ projectId: "team-a", projectName: "Alpha", isPersonal: false, stories: [dragStory("s1", "team-a", "Alpha")] }],
      today: [dragStory("s2", "team-a", "Alpha")],
      free: [{ column: DOING, stories: [dragStory("s3", "team-a", "Alpha")] }],
      done: [],
    };
    const containers = toDragContainers(columns);
    expect(containers.todo.map((i) => i.id)).toEqual(["s1"]);
    expect(containers.today.map((i) => i.id)).toEqual(["s2"]);
    expect(containers.doing.map((i) => i.id)).toEqual(["s3"]); // keyed by the free column's id
    expect(containers.todo[0].storyId).toBe("s1");
  });

  it("gives Done entries unique synthetic ids even when the same story repeats", () => {
    const columns: MyWorkColumns<Row> = {
      todo: [],
      today: [],
      free: [],
      done: [
        { completedAt: "2026-07-20T09:00:00Z", row: rowShape("s1", "team-a", "Alpha") },
        { completedAt: "2026-07-21T09:00:00Z", row: rowShape("s1", "team-a", "Alpha") },
      ],
    };
    const containers = toDragContainers(columns);
    expect(containers.done.map((i) => i.id)).toEqual(["done:0:s1", "done:1:s1"]);
    expect(containers.done.map((i) => i.storyId)).toEqual(["s1", "s1"]);
  });

  it("lets a story appear in both a free column and Done without id collision", () => {
    const columns: MyWorkColumns<Row> = {
      todo: [],
      today: [],
      free: [{ column: DOING, stories: [dragStory("s1", "team-a", "Alpha")] }],
      done: [{ completedAt: "2026-07-19T09:00:00Z", row: rowShape("s1", "team-a", "Alpha") }],
    };
    const containers = toDragContainers(columns);
    const allIds = [...containers.doing, ...containers.done].map((i) => i.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe("regroupByProject", () => {
  function item(id: string, projectId: string, projectName: string): MyWorkDragItem<Row> {
    return { id, storyId: id, completedAt: "", row: rowShape(id, projectId, projectName) };
  }

  it("groups consecutive same-project items into one block", () => {
    const groups = regroupByProject([item("a1", "team-a", "Alpha"), item("a2", "team-a", "Alpha"), item("b1", "team-b", "Bravo")]);
    expect(groups.map((g) => ({ projectId: g.projectId, ids: g.items.map((i) => i.id) }))).toEqual([
      { projectId: "team-a", ids: ["a1", "a2"] },
      { projectId: "team-b", ids: ["b1"] },
    ]);
  });

  it("splits a non-consecutive run into a separate block (post-drag degradation)", () => {
    const groups = regroupByProject([item("a1", "team-a", "Alpha"), item("b1", "team-b", "Bravo"), item("a2", "team-a", "Alpha")]);
    expect(groups.map((g) => g.projectId)).toEqual(["team-a", "team-b", "team-a"]);
  });

  it("returns no groups for an empty list", () => {
    expect(regroupByProject([])).toEqual([]);
  });
});

describe("resolveDragEndTarget", () => {
  it("returns the target column when it differs from the start column", () => {
    expect(resolveDragEndTarget("todo", "doing")).toBe("doing");
  });
  it("returns null when dropped back in the column it started in", () => {
    expect(resolveDragEndTarget("todo", "todo")).toBeNull();
  });
  it("returns null when the start column is unknown", () => {
    expect(resolveDragEndTarget(null, "doing")).toBeNull();
  });
  it("returns null when the drop target is unknown", () => {
    expect(resolveDragEndTarget("todo", null)).toBeNull();
  });
});

describe("resolveColumnOrder", () => {
  it("defaults to todo, today, free columns by position when nothing is stored", () => {
    expect(resolveColumnOrder([], [WAITING, DOING])).toEqual(["todo", "today", "doing", "waiting"]);
  });

  it("uses the stored order verbatim when it already covers everything", () => {
    expect(resolveColumnOrder(["doing", "today", "todo"], [DOING])).toEqual(["doing", "today", "todo"]);
  });

  it("drops a stale id (a deleted free column) from the stored order", () => {
    expect(resolveColumnOrder(["todo", "gone", "today"], [])).toEqual(["todo", "today"]);
  });

  it("appends a newly added free column not yet in the stored order", () => {
    expect(resolveColumnOrder(["todo", "today", "doing"], [DOING, WAITING])).toEqual(["todo", "today", "doing", "waiting"]);
  });

  it("de-dupes a repeated id in the stored order", () => {
    expect(resolveColumnOrder(["todo", "todo", "today"], [])).toEqual(["todo", "today"]);
  });

  it("ignores an id that isn't a known slot", () => {
    expect(resolveColumnOrder(["bogus", "todo", "today"], [])).toEqual(["todo", "today"]);
  });

  // TASK-155 AC#2: Done is excluded from the reorderable order entirely —
  // even a stale "done" left over from before this change is dropped like
  // any other no-longer-valid id.
  it("drops 'done' from a stored order even though it used to be valid there", () => {
    expect(resolveColumnOrder(["done", "doing", "today", "todo"], [DOING])).toEqual(["doing", "today", "todo"]);
  });
});

// TASK-150 follow-up (owner request 2026-07-22): the three fixed slots can be
// renamed, display-label only.
describe("resolveColumnNames", () => {
  it("defaults every slot when nothing is stored", () => {
    expect(resolveColumnNames(undefined)).toEqual({ todo: "Todo", today: "Today", done: "Done" });
    expect(resolveColumnNames(null)).toEqual({ todo: "Todo", today: "Today", done: "Done" });
    expect(resolveColumnNames({})).toEqual({ todo: "Todo", today: "Today", done: "Done" });
  });

  it("uses a stored override per slot, leaving the rest at their default", () => {
    expect(resolveColumnNames({ today: "Focus" })).toEqual({ todo: "Todo", today: "Focus", done: "Done" });
  });

  it("falls back to the default for a blank or non-string override", () => {
    expect(resolveColumnNames({ todo: "  ", today: 5, done: null })).toEqual({ todo: "Todo", today: "Today", done: "Done" });
  });

  it("ignores a non-object value entirely", () => {
    expect(resolveColumnNames("bogus")).toEqual({ todo: "Todo", today: "Today", done: "Done" });
    expect(resolveColumnNames(["todo"])).toEqual({ todo: "Todo", today: "Today", done: "Done" });
  });
});

// TASK-145/TASK-150: Today and every free column carry their own persisted
// card order (doc-15 decision 4, extended to free columns) — Todo/Done have
// none, so a same-container drop there stays a true no-op.
// doc-17 #10: a team story's drop on Done is rejected server-side (it
// completes only on its own board), so the drag-over UI must not accept it
// either, or the card visibly enters Done and snaps back once rejected.
describe("canDropOnDone", () => {
  it("is droppable for a personal-project card", () => {
    expect(canDropOnDone(true)).toBe(true);
  });

  it("is not droppable for a team card", () => {
    expect(canDropOnDone(false)).toBe(false);
  });
});

describe("isManualOrderReorder", () => {
  it("is true for a same-container drop within Today or a free column", () => {
    expect(isManualOrderReorder("today", "today")).toBe(true);
    expect(isManualOrderReorder("doing", "doing")).toBe(true);
  });

  it("is false for a same-container drop within Todo or Done", () => {
    expect(isManualOrderReorder("todo", "todo")).toBe(false);
    expect(isManualOrderReorder("done", "done")).toBe(false);
  });

  it("is false when the container actually changed (not a reorder)", () => {
    expect(isManualOrderReorder("today", "todo")).toBe(false);
    expect(isManualOrderReorder("todo", "today")).toBe(false);
  });

  it("is false when either side is unknown", () => {
    expect(isManualOrderReorder(null, "today")).toBe(false);
    expect(isManualOrderReorder("today", null)).toBe(false);
  });
});
