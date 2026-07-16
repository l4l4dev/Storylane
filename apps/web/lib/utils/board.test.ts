import { describe, expect, it } from "vitest";
import {
  beforeAnchorId,
  findContainer,
  groupStoriesByIteration,
  isOverWipLimit,
  laneContainerKey,
  parseLaneContainerKey,
  reorderContainer,
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

describe("isOverWipLimit", () => {
  it("is false when no limit is set", () => {
    expect(isOverWipLimit(10, null)).toBe(false);
  });

  it("is false when the count is at or below the limit", () => {
    expect(isOverWipLimit(3, 3)).toBe(false);
    expect(isOverWipLimit(2, 3)).toBe(false);
  });

  it("is true once the count exceeds the limit", () => {
    expect(isOverWipLimit(4, 3)).toBe(true);
  });
});

describe("laneContainerKey / parseLaneContainerKey", () => {
  it("round-trips a status paired with a real lane", () => {
    const key = laneContainerKey("status-1", "lane-1");
    expect(key).toBe("status-1::lane-1");
    expect(parseLaneContainerKey(key)).toEqual({ statusId: "status-1", laneId: "lane-1" });
  });

  it("round-trips the No lane band as a null laneId", () => {
    const key = laneContainerKey("status-1", null);
    expect(parseLaneContainerKey(key)).toEqual({ statusId: "status-1", laneId: null });
  });

  it("never collides with a bare status id (the no-lanes board's container key)", () => {
    expect(laneContainerKey("status-1", "lane-1")).not.toBe("status-1");
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

describe("reorderContainer", () => {
  // TASK-20: a filtered view only ever renders a subset of a zone's items,
  // so activeId/overId always belong to *visible* rows — but reordering must
  // run against the full, unfiltered list or a hidden row's relative
  // position (and thus its stored `position`) gets corrupted.
  it("moves the active item next to the over item, leaving every other item (including ones hidden by a filter) in place", () => {
    const full = [{ id: "a" }, { id: "h1" }, { id: "b" }, { id: "h2" }, { id: "c" }];
    // The user only sees a/b/c (h1/h2 are hidden by an active filter) and
    // drags "c" to just before "a".
    const result = reorderContainer(full, "c", "a");
    expect(result.map((i) => i.id)).toEqual(["c", "a", "h1", "b", "h2"]);
  });

  it("moving an item later shifts the over item's old neighbors correctly", () => {
    const full = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(reorderContainer(full, "a", "c").map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when active and over are the same item", () => {
    const full = [{ id: "a" }, { id: "b" }];
    expect(reorderContainer(full, "a", "a").map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns the list unchanged when either id is missing", () => {
    const full = [{ id: "a" }, { id: "b" }];
    expect(reorderContainer(full, "missing", "b").map((i) => i.id)).toEqual(["a", "b"]);
  });

  // TASK-20 AC#2/#4: a Kanban state column reorder, filtered by assignee —
  // the hidden story sitting between two visible ones must not collide with
  // or displace anything once positions are re-densified afterwards.
  it("Kanban: reordering a filtered state column never collides two rows on the same position", () => {
    const column = [{ id: "s1" }, { id: "s2-hidden" }, { id: "s3" }];
    const reordered = reorderContainer(column, "s3", "s1");
    const positions = reordered.map((item, i) => ({ id: item.id, position: i }));
    expect(new Set(positions.map((p) => p.position)).size).toBe(positions.length);
    expect(positions.find((p) => p.id === "s2-hidden")?.position).toBe(2);
  });

  // TASK-20 AC#4: the List view's Backlog mixes stories and
  // `backlog_dividers` rows in one sequence — a divider sitting right next
  // to a story hidden by the active filter must keep its exact neighbor
  // relationship after a reorder elsewhere in the list.
  it("List: a divider adjacent to a filter-hidden story keeps its position when an unrelated pair reorders", () => {
    const backlog = [
      { id: "story:s1" },
      { id: "story:s2-hidden" },
      { id: "divider:d1" },
      { id: "story:s3" },
    ];
    const reordered = reorderContainer(backlog, "story:s3", "story:s1");
    expect(reordered.map((i) => i.id)).toEqual(["story:s3", "story:s1", "story:s2-hidden", "divider:d1"]);
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
