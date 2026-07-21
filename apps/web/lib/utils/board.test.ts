import { describe, expect, it } from "vitest";
import {
  beforeAnchorId,
  findContainer,
  groupStoriesByIteration,
  restoreItemPosition,
  storyById,
  sumPoints,
} from "./board";

describe("groupStoriesByIteration", () => {
  it("separates backlog stories from iteration-assigned ones", () => {
    const stories = [
      { id: "1", iteration_id: "it-1" },
      { id: "2", iteration_id: null },
      { id: "3", iteration_id: "it-1" },
      { id: "4", iteration_id: "it-2" },
    ];
    const { byIteration, backlog } = groupStoriesByIteration(stories);

    expect(backlog.map((s) => s.id)).toEqual(["2"]);
    expect(byIteration.get("it-1")?.map((s) => s.id)).toEqual(["1", "3"]);
    expect(byIteration.get("it-2")?.map((s) => s.id)).toEqual(["4"]);
  });

  it("returns empty results for an empty input", () => {
    const { byIteration, backlog } = groupStoriesByIteration([]);
    expect(backlog).toEqual([]);
    expect(byIteration.size).toBe(0);
  });

  it("treats every story as backlog when none are assigned", () => {
    const stories = [{ id: "1", iteration_id: null }, { id: "2", iteration_id: null }];
    const { byIteration, backlog } = groupStoriesByIteration(stories);
    expect(backlog.map((s) => s.id)).toEqual(["1", "2"]);
    expect(byIteration.size).toBe(0);
  });
});

describe("sumPoints", () => {
  it("sums points for point-bearing story types only", () => {
    const stories = [
      { points: 3, story_type: "feature" },
      { points: 2, story_type: "bug" },
      { points: null, story_type: "chore" },
      { points: null, story_type: "release" },
    ];
    expect(sumPoints(stories)).toBe(5);
  });

  it("returns 0 for an empty list", () => {
    expect(sumPoints([])).toBe(0);
  });
});

describe("findContainer", () => {
  const containers = {
    backlog: [{ id: "1" }, { id: "2" }],
    current: [{ id: "3" }],
    icebox: [] as { id: string }[],
  };

  it("finds the container whose list holds the item", () => {
    expect(findContainer(containers, "2")).toBe("backlog");
    expect(findContainer(containers, "3")).toBe("current");
  });

  it("returns the container id itself when hovering an empty container directly", () => {
    expect(findContainer(containers, "icebox")).toBe("icebox");
  });

  it("returns undefined for an id that matches nothing", () => {
    expect(findContainer(containers, "missing")).toBeUndefined();
  });
});

describe("storyById", () => {
  const containers = {
    backlog: [{ id: "1", title: "a" }],
    current: [{ id: "2", title: "b" }],
  };

  it("finds an item across every container", () => {
    expect(storyById(containers, "2")).toEqual({ id: "2", title: "b" });
  });

  it("returns undefined when no container has the id", () => {
    expect(storyById(containers, "missing")).toBeUndefined();
  });
});

describe("beforeAnchorId", () => {
  // TASK-56: the drop handlers send only this "before" anchor instead of the
  // whole ordered sequence — the server re-derives dense positions from it.
  it("returns the neighbour the moved item now sits before, as story:<id>", () => {
    const reordered = [{ id: "a" }, { id: "moved" }, { id: "b" }];
    expect(beforeAnchorId(reordered, "moved")).toBe("story:b");
  });

  it("returns null (append) when the moved item landed last", () => {
    const reordered = [{ id: "a" }, { id: "b" }, { id: "moved" }];
    expect(beforeAnchorId(reordered, "moved")).toBeNull();
  });

  it("returns null when the moved item is absent", () => {
    expect(beforeAnchorId([{ id: "a" }, { id: "b" }], "missing")).toBeNull();
  });

  it("preserves each item's own kind for the List view's mixed story/divider order", () => {
    const reordered = [
      { id: "s1", kind: "story" },
      { id: "moved", kind: "story" },
      { id: "d1", kind: "divider" },
    ];
    expect(beforeAnchorId(reordered, "moved")).toBe("divider:d1");
  });
});

describe("restoreItemPosition", () => {
  const ids = (items: { id: string }[]) => items.map((i) => i.id);

  // TASK-113 finding #4: a failed async drop must move only the dragged item
  // back to its pre-drag slot, leaving every other item where it currently is
  // (a sibling drag that landed while this one was in flight must survive).
  it("moves the item back to its snapshot container/index without touching others", () => {
    const snapshot = { a: [{ id: "x" }, { id: "y" }], b: [{ id: "z" }] };
    // x was optimistically dragged a→b; meanwhile a sibling reordered b.
    const current = { a: [{ id: "y" }], b: [{ id: "z-moved" }, { id: "x" }] };

    const result = restoreItemPosition(current, snapshot, "x");

    expect(ids(result.a)).toEqual(["x", "y"]); // x restored to a[0]
    expect(ids(result.b)).toEqual(["z-moved"]); // sibling's move preserved
  });

  it("restores an item that was reordered within the same container", () => {
    const snapshot = { a: [{ id: "x" }, { id: "y" }, { id: "z" }] };
    const current = { a: [{ id: "y" }, { id: "z" }, { id: "x" }] }; // x dragged to end

    expect(ids(restoreItemPosition(current, snapshot, "x").a)).toEqual(["x", "y", "z"]);
  });

  it("clamps the insert index when later items are gone from the target", () => {
    const snapshot = { a: [{ id: "p" }, { id: "q" }, { id: "x" }] }; // x at index 2
    const current = { a: [{ id: "x" }] }; // p, q removed concurrently

    expect(ids(restoreItemPosition(current, snapshot, "x").a)).toEqual(["x"]);
  });

  it("leaves current unchanged when the id is not in the snapshot", () => {
    const snapshot = { a: [{ id: "x" }] };
    const current = { a: [{ id: "x" }], b: [{ id: "new" }] };

    expect(restoreItemPosition(current, snapshot, "new")).toBe(current);
  });
});
