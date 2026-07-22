import { describe, expect, it } from "vitest";
import {
  assignedColumn,
  classifyMyWork,
  groupDoneByDate,
  type DoneEntry,
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
