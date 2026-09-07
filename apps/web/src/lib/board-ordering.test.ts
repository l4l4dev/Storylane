import { describe, expect, it } from "vitest";
import { columnOf, moveStoryTo, orderedIdsFor, type ColumnView } from "./board-ordering";

const columns = (): ColumnView[] => [
  { stateId: null, storyIds: ["i1", "i2"] },
  { stateId: "todo", storyIds: ["t1", "t2", "t3"] },
  { stateId: "done", storyIds: [] },
];

describe("moveStoryTo", () => {
  it("reorders within a column", () => {
    const next = moveStoryTo(columns(), "t3", "todo", 0);
    expect(orderedIdsFor(next, "todo")).toEqual(["t3", "t1", "t2"]);
  });

  it("moves across columns at the requested index", () => {
    const next = moveStoryTo(columns(), "i1", "todo", 1);
    expect(orderedIdsFor(next, "todo")).toEqual(["t1", "i1", "t2", "t3"]);
    expect(orderedIdsFor(next, null)).toEqual(["i2"]);
  });

  it("appends when the index is past the end and clamps a negative index", () => {
    expect(orderedIdsFor(moveStoryTo(columns(), "i1", "done", 99), "done")).toEqual(["i1"]);
    expect(orderedIdsFor(moveStoryTo(columns(), "t3", "todo", -5), "todo")).toEqual(["t3", "t1", "t2"]);
  });

  it("moves into the Icebox (null state)", () => {
    const next = moveStoryTo(columns(), "t1", null, 0);
    expect(orderedIdsFor(next, null)).toEqual(["t1", "i1", "i2"]);
  });

  it("leaves the board untouched for an unknown story or column", () => {
    expect(moveStoryTo(columns(), "ghost", "todo", 0)).toEqual(columns());
    expect(moveStoryTo(columns(), "t1", "nope", 0)).toEqual(columns());
  });

  it("never mutates its input", () => {
    const before = columns();
    moveStoryTo(before, "t1", null, 0);
    expect(before).toEqual(columns());
  });
});

describe("columnOf", () => {
  it("finds the column holding a story", () => {
    expect(columnOf(columns(), "t2")?.stateId).toBe("todo");
    expect(columnOf(columns(), "i2")?.stateId).toBeNull();
    expect(columnOf(columns(), "ghost")).toBeUndefined();
  });
});
