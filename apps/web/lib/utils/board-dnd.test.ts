import { describe, expect, it } from "vitest";
import { reorderContainer, reorderIds } from "./board-dnd";

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

describe("reorderIds", () => {
  // TASK-148: My Work's column display order is a bare string[] of slot ids
  // (not `{id}[]`), so it needs its own relocation helper alongside reorderContainer.
  it("moves the active id next to the over id", () => {
    expect(reorderIds(["todo", "today", "doing", "done"], "done", "today")).toEqual([
      "todo",
      "done",
      "today",
      "doing",
    ]);
  });

  it("is a no-op when active and over are the same id", () => {
    expect(reorderIds(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });

  it("returns the list unchanged when either id is missing", () => {
    expect(reorderIds(["a", "b"], "missing", "b")).toEqual(["a", "b"]);
  });
});
