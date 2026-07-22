import { describe, expect, it } from "vitest";
import {
  assignedColumn,
  classifyMyWork,
  groupDoneByDate,
  regroupByProject,
  resolveDragEndTarget,
  toDragContainers,
  type DoneEntry,
  type MyWorkColumns,
  type MyWorkDragItem,
  type MyWorkProject,
  type MyWorkStory,
} from "./my-work";

const PERSONAL: MyWorkProject = { id: "personal", name: "Owner's tasks", isPersonal: true };
const TEAM_A: MyWorkProject = { id: "team-a", name: "Alpha", isPersonal: false };
const TEAM_B: MyWorkProject = { id: "team-b", name: "Bravo", isPersonal: false };

// Each story's `row` is just its id here — classification never inspects it.
function story(overrides: Partial<MyWorkStory<string>> & { id: string; projectId: string }): MyWorkStory<string> {
  return {
    position: 0,
    category: "unstarted",
    isToday: false,
    localStatus: null,
    mapped: false,
    localUpdatedAt: null,
    row: overrides.id,
    ...overrides,
  };
}

function completion(id: string, completedAt: string): DoneEntry<string> {
  return { completedAt, row: id };
}

describe("assignedColumn", () => {
  it("routes a real-done story to null (Done handled via its completion log)", () => {
    expect(assignedColumn(story({ id: "s", projectId: "team-a", category: "done" }))).toBeNull();
  });

  it("unmapped in_progress with no local override -> doing", () => {
    expect(assignedColumn(story({ id: "s", projectId: "team-a", category: "in_progress" }))).toBe("doing");
  });

  it("unmapped local_status='done' -> done (cancellable local mark, outranks Today)", () => {
    expect(
      assignedColumn(story({ id: "s", projectId: "team-a", isToday: true, localStatus: "done" })),
    ).toBe("done");
  });

  it("mapped project derives from real state and ignores local_status", () => {
    // local says done, but a mapped project reads the real category: unstarted -> todo.
    expect(
      assignedColumn(story({ id: "s", projectId: "team-a", mapped: true, category: "unstarted", localStatus: "done" })),
    ).toBe("todo");
    expect(
      assignedColumn(story({ id: "s", projectId: "team-a", mapped: true, category: "in_progress", localStatus: "todo" })),
    ).toBe("doing");
  });

  it("isToday wins over the derived todo/doing slot", () => {
    expect(assignedColumn(story({ id: "s", projectId: "team-a", isToday: true, category: "in_progress" }))).toBe("today");
  });
});

describe("classifyMyWork", () => {
  it("places assigned stories into todo/today/doing by precedence", () => {
    const { todo, today, doing } = classifyMyWork(
      [
        story({ id: "backlog", projectId: "team-a" }),
        story({ id: "live", projectId: "team-a", category: "in_progress" }),
        story({ id: "planned", projectId: "team-a", isToday: true }),
      ],
      [],
      [TEAM_A],
    );
    expect(todo.flatMap((g) => g.stories.map((s) => s.id))).toEqual(["backlog"]);
    expect(today.map((s) => s.id)).toEqual(["planned"]);
    expect(doing.map((s) => s.id)).toEqual(["live"]);
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
    );
    expect(todo.map((g) => g.projectId)).toEqual(["personal", "team-a", "team-b"]);
    expect(todo[2].stories.map((s) => s.id)).toEqual(["b1", "b2"]);
  });

  it("Done = completion rows (incl. one per repeat) live-joined, newest first", () => {
    const { done } = classifyMyWork(
      [],
      [completion("s", "2026-07-20T09:00:00Z"), completion("s", "2026-07-21T09:00:00Z")],
      [TEAM_A],
    );
    const groups = groupDoneByDate(done);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-07-21", "2026-07-20"]);
    // A story completed twice renders as two entries, never deduped.
    expect(done).toHaveLength(2);
  });

  it("unmapped local_status='done' becomes a Done entry dated by its mark", () => {
    const { done, todo, doing } = classifyMyWork(
      [story({ id: "s", projectId: "team-a", localStatus: "done", localUpdatedAt: "2026-07-22T10:00:00Z" })],
      [],
      [TEAM_A],
    );
    expect(done.map((d) => d.completedAt)).toEqual(["2026-07-22T10:00:00Z"]);
    // ...and nowhere in the active columns.
    expect(todo).toEqual([]);
    expect(doing).toEqual([]);
  });

  it("a past completion + currently reopened in_progress+assigned shows in BOTH Done and Doing", () => {
    const { done, doing } = classifyMyWork(
      [story({ id: "s", projectId: "team-a", category: "in_progress" })],
      [completion("s", "2026-07-19T09:00:00Z")],
      [TEAM_A],
    );
    expect(doing.map((s) => s.id)).toEqual(["s"]);
    expect(done.map((d) => d.row)).toEqual(["s"]);
  });

  it("a mapped story whose real state is still done + local todo stays out of Todo/Doing", () => {
    // "To Todo" never calls set_story_state, so real category stays done ->
    // assignedColumn null; only the completion log carries it.
    const { todo, doing, done } = classifyMyWork(
      [story({ id: "s", projectId: "team-a", mapped: true, category: "done", localStatus: "todo" })],
      [completion("s", "2026-07-18T09:00:00Z")],
      [TEAM_A],
    );
    expect(todo).toEqual([]);
    expect(doing).toEqual([]);
    expect(done.map((d) => d.row)).toEqual(["s"]);
  });
});

// TASK-132: drag-container helpers need a row shape with id/projectId/
// projectName (unlike the bare-string `row` used by the classification tests
// above).
type Row = { id: string; projectId: string; projectName: string };
function row(id: string, projectId: string, projectName: string): Row {
  return { id, projectId, projectName };
}
function dragStory(id: string, projectId: string, projectName: string): MyWorkStory<Row> {
  return {
    id,
    projectId,
    position: 0,
    category: "unstarted",
    isToday: false,
    localStatus: null,
    mapped: false,
    localUpdatedAt: null,
    row: row(id, projectId, projectName),
  };
}

describe("toDragContainers", () => {
  it("gives Todo/Today/Doing the bare story id as their dnd-kit id", () => {
    const columns: MyWorkColumns<Row> = {
      todo: [{ projectId: "team-a", projectName: "Alpha", isPersonal: false, stories: [dragStory("s1", "team-a", "Alpha")] }],
      today: [dragStory("s2", "team-a", "Alpha")],
      doing: [dragStory("s3", "team-a", "Alpha")],
      done: [],
    };
    const containers = toDragContainers(columns);
    expect(containers.todo.map((i) => i.id)).toEqual(["s1"]);
    expect(containers.today.map((i) => i.id)).toEqual(["s2"]);
    expect(containers.doing.map((i) => i.id)).toEqual(["s3"]);
    expect(containers.todo[0].storyId).toBe("s1");
  });

  it("gives Done entries unique synthetic ids even when the same story repeats", () => {
    const columns: MyWorkColumns<Row> = {
      todo: [],
      today: [],
      doing: [],
      done: [
        { completedAt: "2026-07-20T09:00:00Z", row: row("s1", "team-a", "Alpha") },
        { completedAt: "2026-07-21T09:00:00Z", row: row("s1", "team-a", "Alpha") },
      ],
    };
    const containers = toDragContainers(columns);
    expect(containers.done.map((i) => i.id)).toEqual(["done:0:s1", "done:1:s1"]);
    // Both still point back at the same underlying story for the server call.
    expect(containers.done.map((i) => i.storyId)).toEqual(["s1", "s1"]);
  });

  it("lets a story appear in both an active column and Done without id collision", () => {
    const columns: MyWorkColumns<Row> = {
      todo: [],
      today: [],
      doing: [dragStory("s1", "team-a", "Alpha")],
      done: [{ completedAt: "2026-07-19T09:00:00Z", row: row("s1", "team-a", "Alpha") }],
    };
    const containers = toDragContainers(columns);
    const allIds = [...containers.doing, ...containers.done].map((i) => i.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe("regroupByProject", () => {
  function item(id: string, projectId: string, projectName: string): MyWorkDragItem<Row> {
    return { id, storyId: id, completedAt: "", row: row(id, projectId, projectName) };
  }

  it("groups consecutive same-project items into one block", () => {
    const groups = regroupByProject([
      item("a1", "team-a", "Alpha"),
      item("a2", "team-a", "Alpha"),
      item("b1", "team-b", "Bravo"),
    ]);
    expect(groups.map((g) => ({ projectId: g.projectId, ids: g.items.map((i) => i.id) }))).toEqual([
      { projectId: "team-a", ids: ["a1", "a2"] },
      { projectId: "team-b", ids: ["b1"] },
    ]);
  });

  it("splits a non-consecutive run into a separate block (post-drag degradation)", () => {
    const groups = regroupByProject([
      item("a1", "team-a", "Alpha"),
      item("b1", "team-b", "Bravo"),
      item("a2", "team-a", "Alpha"),
    ]);
    expect(groups.map((g) => g.projectId)).toEqual(["team-a", "team-b", "team-a"]);
  });

  it("returns no groups for an empty list", () => {
    expect(regroupByProject([])).toEqual([]);
  });
});

// TASK-132 regression: a drag-end handler must compare the column the card
// STARTED in against the drop target, never a container re-derived from
// live (already-optimistically-moved) state — see resolveDragEndTarget's
// own doc comment for the bug this guards against.
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
