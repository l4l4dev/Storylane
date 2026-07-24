import { describe, expect, it } from "vitest";
import {
  addChild,
  addChildFromSelection,
  applyTaskDrop,
  assignTaskToChild,
  removeChild,
  unassignTask,
  updateChild,
  SOURCE_TASKS_DROP_ID,
  type SplitChildDraft,
} from "./split-studio";

function makeChild(over: Partial<SplitChildDraft> = {}): SplitChildDraft {
  return { id: "c1", title: "", description: "", storyType: "feature", points: null, taskIds: [], ...over };
}

describe("addChild", () => {
  it("appends a blank child card", () => {
    const result = addChild([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "", description: "", storyType: "feature", points: null, taskIds: [] });
  });

  it("assigns each new child a distinct id", () => {
    const result = addChild(addChild([]));
    expect(result[0].id).not.toBe(result[1].id);
  });
});

describe("addChildFromSelection", () => {
  it("appends a child seeded with the selected text as its description", () => {
    const result = addChildFromSelection([], "Handle the edge case where the user is offline");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "", description: "Handle the edge case where the user is offline" });
  });

  it("ignores an empty or whitespace-only selection", () => {
    expect(addChildFromSelection([], "")).toHaveLength(0);
    expect(addChildFromSelection([], "   ")).toHaveLength(0);
  });
});

describe("removeChild", () => {
  it("removes the matching child by id", () => {
    const children = [makeChild({ id: "c1" }), makeChild({ id: "c2" })];
    expect(removeChild(children, "c1").map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("updateChild", () => {
  it("patches only the matching child", () => {
    const children = [makeChild({ id: "c1", title: "A" }), makeChild({ id: "c2", title: "B" })];
    const result = updateChild(children, "c1", { title: "Updated" });
    expect(result.find((c) => c.id === "c1")?.title).toBe("Updated");
    expect(result.find((c) => c.id === "c2")?.title).toBe("B");
  });
});

describe("assignTaskToChild", () => {
  it("adds the task id to the target child", () => {
    const children = [makeChild({ id: "c1" }), makeChild({ id: "c2" })];
    const result = assignTaskToChild(children, "t1", "c1");
    expect(result.find((c) => c.id === "c1")?.taskIds).toEqual(["t1"]);
    expect(result.find((c) => c.id === "c2")?.taskIds).toEqual([]);
  });

  it("moves a task from one child to another instead of duplicating it", () => {
    const children = [makeChild({ id: "c1", taskIds: ["t1"] }), makeChild({ id: "c2" })];
    const result = assignTaskToChild(children, "t1", "c2");
    expect(result.find((c) => c.id === "c1")?.taskIds).toEqual([]);
    expect(result.find((c) => c.id === "c2")?.taskIds).toEqual(["t1"]);
  });

  it("is a no-op re-drop onto the same child (no duplicate entry)", () => {
    const children = [makeChild({ id: "c1", taskIds: ["t1"] })];
    const result = assignTaskToChild(children, "t1", "c1");
    expect(result.find((c) => c.id === "c1")?.taskIds).toEqual(["t1"]);
  });
});

describe("unassignTask", () => {
  it("removes the task from whichever child currently holds it", () => {
    const children = [makeChild({ id: "c1", taskIds: ["t1", "t2"] }), makeChild({ id: "c2" })];
    const result = unassignTask(children, "t1");
    expect(result.find((c) => c.id === "c1")?.taskIds).toEqual(["t2"]);
  });

  it("is a no-op when no child holds the task", () => {
    const children = [makeChild({ id: "c1" })];
    expect(unassignTask(children, "unknown")).toEqual(children);
  });
});

// Routes a dnd-kit DragEndEvent's (active, over) pair to the right pure
// transition — the only piece of the drag wiring worth unit testing (dnd-kit
// itself, and the pointer sequence, are exercised in the browser instead).
describe("applyTaskDrop", () => {
  it("assigns the task to the child it was dropped on", () => {
    const children = [makeChild({ id: "c1" }), makeChild({ id: "c2" })];
    const result = applyTaskDrop(children, "t1", "c2");
    expect(result.find((c) => c.id === "c2")?.taskIds).toEqual(["t1"]);
  });

  it("unassigns the task when dropped back on the source list", () => {
    const children = [makeChild({ id: "c1", taskIds: ["t1"] })];
    const result = applyTaskDrop(children, "t1", SOURCE_TASKS_DROP_ID);
    expect(result.find((c) => c.id === "c1")?.taskIds).toEqual([]);
  });

  it("is a no-op when dropped nowhere (over is null)", () => {
    const children = [makeChild({ id: "c1", taskIds: ["t1"] })];
    expect(applyTaskDrop(children, "t1", null)).toEqual(children);
  });
});
