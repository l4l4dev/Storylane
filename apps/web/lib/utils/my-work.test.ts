import { describe, expect, it } from "vitest";
import { buildMyWorkSections, type MyWorkProject, type MyWorkStory } from "./my-work";

const PERSONAL: MyWorkProject = { id: "personal", name: "Mika's tasks", isPersonal: true };
const TEAM_B: MyWorkProject = { id: "team-b", name: "Bravo", isPersonal: false };
const TEAM_A: MyWorkProject = { id: "team-a", name: "Alpha", isPersonal: false };

function story(overrides: Partial<MyWorkStory> & { id: string; projectId: string }): MyWorkStory {
  return { iterationId: null, position: 0, ...overrides };
}

describe("buildMyWorkSections", () => {
  it("puts a personal project's current-iteration story in Today", () => {
    const { today, assigned } = buildMyWorkSections(
      [story({ id: "s1", projectId: "personal", iterationId: "iter-1", position: 0 })],
      [PERSONAL],
      new Map([["personal", "iter-1"]]),
      new Set(),
    );
    expect(today.map((s) => s.id)).toEqual(["s1"]);
    expect(assigned).toEqual([]);
  });

  it("keeps a personal project's non-current-iteration story out of Today", () => {
    const { today, assigned } = buildMyWorkSections(
      [story({ id: "s1", projectId: "personal", iterationId: "iter-old", position: 0 })],
      [PERSONAL],
      new Map([["personal", "iter-1"]]),
      new Set(),
    );
    expect(today).toEqual([]);
    expect(assigned.map((g) => g.projectId)).toEqual(["personal"]);
  });

  it("puts a pinned story from a non-personal project in Today", () => {
    const { today } = buildMyWorkSections(
      [story({ id: "s1", projectId: "team-a", position: 0 })],
      [TEAM_A],
      new Map(),
      new Set(["s1"]),
    );
    expect(today.map((s) => s.id)).toEqual(["s1"]);
  });

  it("leaves an unpinned non-personal-project story out of Today", () => {
    const { today, assigned } = buildMyWorkSections(
      [story({ id: "s1", projectId: "team-a", position: 0 })],
      [TEAM_A],
      new Map(),
      new Set(),
    );
    expect(today).toEqual([]);
    expect(assigned[0].stories.map((s) => s.id)).toEqual(["s1"]);
  });

  it("groups Assigned by project: personal first, then project name", () => {
    const { assigned } = buildMyWorkSections(
      [
        story({ id: "b1", projectId: "team-b", iterationId: "iter-b", position: 0 }),
        story({ id: "a1", projectId: "team-a", position: 0 }),
        story({ id: "p1", projectId: "personal", iterationId: "iter-old", position: 0 }),
      ],
      [TEAM_A, TEAM_B, PERSONAL],
      new Map([["personal", "iter-1"]]),
      new Set(),
    );
    expect(assigned.map((g) => g.projectId)).toEqual(["personal", "team-a", "team-b"]);
  });

  it("orders stories within a group by board position", () => {
    const { assigned } = buildMyWorkSections(
      [
        story({ id: "second", projectId: "team-a", position: 2 }),
        story({ id: "first", projectId: "team-a", position: 1 }),
      ],
      [TEAM_A],
      new Map(),
      new Set(),
    );
    expect(assigned[0].stories.map((s) => s.id)).toEqual(["first", "second"]);
  });

  it("orders Today by personal-project group first, then position", () => {
    const { today } = buildMyWorkSections(
      [
        story({ id: "pinned", projectId: "team-a", position: 0 }),
        story({ id: "current", projectId: "personal", iterationId: "iter-1", position: 0 }),
      ],
      [TEAM_A, PERSONAL],
      new Map([["personal", "iter-1"]]),
      new Set(["pinned"]),
    );
    expect(today.map((s) => s.id)).toEqual(["current", "pinned"]);
  });
});
