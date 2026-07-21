import { describe, expect, it } from "vitest";
import {
  buildMyWorkSections,
  groupDoneByDate,
  type MyWorkProject,
  type MyWorkStory,
} from "./my-work";

const PERSONAL: MyWorkProject = { id: "personal", name: "Mika's tasks", isPersonal: true };
const TEAM_B: MyWorkProject = { id: "team-b", name: "Bravo", isPersonal: false };
const TEAM_A: MyWorkProject = { id: "team-a", name: "Alpha", isPersonal: false };

function story(overrides: Partial<MyWorkStory> & { id: string; projectId: string }): MyWorkStory {
  return { iterationId: null, position: 0, category: "unstarted", ...overrides };
}

describe("buildMyWorkSections", () => {
  it("puts a personal project's current-iteration story in Today", () => {
    const { today, todo } = buildMyWorkSections(
      [story({ id: "s1", projectId: "personal", iterationId: "iter-1" })],
      [PERSONAL],
      new Map([["personal", "iter-1"]]),
      new Set(),
    );
    expect(today.map((s) => s.id)).toEqual(["s1"]);
    expect(todo).toEqual([]);
  });

  it("puts a pinned story in Today regardless of project or category", () => {
    const { today } = buildMyWorkSections(
      [story({ id: "s1", projectId: "team-a", category: "in_progress" })],
      [TEAM_A],
      new Map(),
      new Set(["s1"]),
    );
    expect(today.map((s) => s.id)).toEqual(["s1"]);
  });

  it("puts an in_progress story (not in Today) in Doing", () => {
    const { doing, todo } = buildMyWorkSections(
      [story({ id: "s1", projectId: "team-a", category: "in_progress" })],
      [TEAM_A],
      new Map(),
      new Set(),
    );
    expect(doing.map((s) => s.id)).toEqual(["s1"]);
    expect(todo).toEqual([]);
  });

  it("puts a rejected story in Todo, not Doing (rejected is neither done nor in_progress)", () => {
    const { doing, todo } = buildMyWorkSections(
      [story({ id: "s1", projectId: "team-a", category: "rejected" })],
      [TEAM_A],
      new Map(),
      new Set(),
    );
    expect(doing).toEqual([]);
    expect(todo[0].stories.map((s) => s.id)).toEqual(["s1"]);
  });

  it("groups Todo by project: personal first, then project name", () => {
    const { todo } = buildMyWorkSections(
      [
        story({ id: "b1", projectId: "team-b" }),
        story({ id: "a1", projectId: "team-a" }),
        story({ id: "p1", projectId: "personal", iterationId: "iter-old" }),
      ],
      [TEAM_A, TEAM_B, PERSONAL],
      new Map([["personal", "iter-1"]]),
      new Set(),
    );
    expect(todo.map((g) => g.projectId)).toEqual(["personal", "team-a", "team-b"]);
  });

  it("orders stories within a Todo group by board position", () => {
    const { todo } = buildMyWorkSections(
      [
        story({ id: "second", projectId: "team-a", position: 2 }),
        story({ id: "first", projectId: "team-a", position: 1 }),
      ],
      [TEAM_A],
      new Map(),
      new Set(),
    );
    expect(todo[0].stories.map((s) => s.id)).toEqual(["first", "second"]);
  });

  it("orders Today by personal-project group first, then position", () => {
    const { today } = buildMyWorkSections(
      [
        story({ id: "team-pinned", projectId: "team-a", position: 0 }),
        story({ id: "personal-second", projectId: "personal", iterationId: "iter-1", position: 2 }),
        story({ id: "personal-first", projectId: "personal", iterationId: "iter-1", position: 1 }),
      ],
      [PERSONAL, TEAM_A],
      new Map([["personal", "iter-1"]]),
      new Set(["team-pinned"]),
    );
    expect(today.map((s) => s.id)).toEqual(["personal-first", "personal-second", "team-pinned"]);
  });

  it("keeps a personal project's non-current-iteration, unpinned story out of Today", () => {
    const { today, todo } = buildMyWorkSections(
      [story({ id: "s1", projectId: "personal", iterationId: "iter-old" })],
      [PERSONAL],
      new Map([["personal", "iter-1"]]),
      new Set(),
    );
    expect(today).toEqual([]);
    expect(todo[0].stories.map((s) => s.id)).toEqual(["s1"]);
  });

  it("onlyCurrentIteration drops out-of-iteration stories from Doing and Todo but not Today", () => {
    const stories = [
      story({ id: "todo-current", projectId: "team-a", iterationId: "iter-a" }),
      story({ id: "todo-backlog", projectId: "team-a", iterationId: null }),
      story({ id: "doing-current", projectId: "team-a", iterationId: "iter-a", category: "in_progress" }),
      story({ id: "doing-backlog", projectId: "team-a", iterationId: "iter-old", category: "in_progress" }),
      story({ id: "pinned-backlog", projectId: "team-a", iterationId: null }),
    ];
    const { today, doing, todo } = buildMyWorkSections(
      stories,
      [TEAM_A],
      new Map([["team-a", "iter-a"]]),
      new Set(["pinned-backlog"]),
      true,
    );
    // Today keeps the pinned story even though it's not in the current iteration.
    expect(today.map((s) => s.id)).toEqual(["pinned-backlog"]);
    expect(doing.map((s) => s.id)).toEqual(["doing-current"]);
    expect(todo.flatMap((g) => g.stories.map((s) => s.id))).toEqual(["todo-current"]);
  });
});

describe("groupDoneByDate", () => {
  it("groups by UTC date of completed_at, newest date and newest-within-date first", () => {
    const groups = groupDoneByDate([
      { id: "old", completedAt: "2026-07-19T09:00:00Z" },
      { id: "today-early", completedAt: "2026-07-21T08:00:00Z" },
      { id: "today-late", completedAt: "2026-07-21T18:00:00Z" },
    ]);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-07-21", "2026-07-19"]);
    expect(groups[0].stories.map((s) => s.id)).toEqual(["today-late", "today-early"]);
  });

  it("returns an empty array for no done stories", () => {
    expect(groupDoneByDate([])).toEqual([]);
  });
});
