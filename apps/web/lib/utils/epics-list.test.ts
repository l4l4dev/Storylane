import { describe, expect, it } from "vitest";
import { buildContainerListItems, buildEpicBandChildren, type EpicBandChildInput } from "./epics-list";

describe("buildContainerListItems", () => {
  it("groups children by parent and rolls each container up independently", () => {
    const items = buildContainerListItems(
      [
        { id: "e1", number: 5, title: "Epic One", epicColor: "#f00" },
        { id: "e2", number: 8, title: "Epic Two", epicColor: null },
      ],
      [
        { parentId: "e1", category: "done", points: 3 },
        { parentId: "e1", category: "unstarted", points: 2 },
        { parentId: "e2", category: "in_progress", points: 5 },
      ],
    );

    expect(items).toEqual([
      {
        id: "e1",
        number: 5,
        title: "Epic One",
        epicColor: "#f00",
        rollup: {
          headline: "in_progress",
          points: 5,
          breakdown: { unstarted: 1, in_progress: 0, done: 1, rejected: 0, icebox: 0 },
        },
      },
      {
        id: "e2",
        number: 8,
        title: "Epic Two",
        epicColor: null,
        rollup: {
          headline: "in_progress",
          points: 5,
          breakdown: { unstarted: 0, in_progress: 1, done: 0, rejected: 0, icebox: 0 },
        },
      },
    ]);
  });

  it("rolls a childless container up as icebox with 0 points", () => {
    const items = buildContainerListItems([{ id: "e1", number: 1, title: "Empty", epicColor: null }], []);
    expect(items[0].rollup).toEqual({
      headline: "icebox",
      points: 0,
      breakdown: { unstarted: 0, in_progress: 0, done: 0, rejected: 0, icebox: 0 },
    });
  });

  it("preserves container order (already sorted by number upstream)", () => {
    const items = buildContainerListItems(
      [
        { id: "e2", number: 2, title: "B", epicColor: null },
        { id: "e1", number: 1, title: "A", epicColor: null },
      ],
      [],
    );
    expect(items.map((i) => i.id)).toEqual(["e2", "e1"]);
  });
});

function child(overrides: Partial<EpicBandChildInput> & { id: string; parentId: string }): EpicBandChildInput {
  return {
    number: 1,
    title: "Story",
    points: null,
    stateId: null,
    iterationId: null,
    category: null,
    position: 0,
    ...overrides,
  };
}

describe("buildEpicBandChildren", () => {
  it("classifies each child's location: done/rejected win over zone, then current/backlog/icebox", () => {
    const result = buildEpicBandChildren(
      [
        child({ id: "c-done", parentId: "e1", category: "done", stateId: "s1", iterationId: "iter-1" }),
        child({ id: "c-rejected", parentId: "e1", category: "rejected", stateId: "s1", iterationId: "iter-1" }),
        child({ id: "c-current", parentId: "e1", category: "in_progress", stateId: "s1", iterationId: "iter-1" }),
        child({ id: "c-backlog", parentId: "e1", category: "unstarted", stateId: "s1", iterationId: "iter-9" }),
        child({ id: "c-icebox", parentId: "e1", stateId: null }),
      ],
      "iter-1",
    );
    const byId = new Map(result["e1"].map((c) => [c.id, c.location]));
    expect(byId.get("c-done")).toBe("done");
    // Rejected must not blend into done (ux-principles principle 9 — "bounced"
    // and "finished" are not the same terminal state).
    expect(byId.get("c-rejected")).toBe("rejected");
    expect(byId.get("c-current")).toBe("current");
    expect(byId.get("c-backlog")).toBe("backlog");
    expect(byId.get("c-icebox")).toBe("icebox");
  });

  it("sorts done and rejected children by position when they share the same underlying zone", () => {
    const result = buildEpicBandChildren(
      [
        child({ id: "rejected-1", parentId: "e1", category: "rejected", position: 5 }),
        child({ id: "done-1", parentId: "e1", category: "done", position: 1 }),
      ],
      null,
    );
    // Both default to stateId: null -> the same underlying zone (icebox) ->
    // comparable positions, sorted normally within it.
    expect(result["e1"].map((c) => c.id)).toEqual(["done-1", "rejected-1"]);
  });

  // /code-review: ranking by BandChildLocation (done/rejected as one shared
  // bucket) would have compared these two children's positions directly even
  // though they come from different underlying sequences — exactly the
  // cross-zone comparison this function's own doc comment forbids. Ranking by
  // the underlying zone instead keeps a current-iteration accept from
  // out-ranking a since-finalized iteration's accept by raw position alone.
  it("never compares position across zones even when both children show the same done/rejected dot", () => {
    const result = buildEpicBandChildren(
      [
        // Zone "backlog" (iteration doesn't match current): low position, but
        // from a different sequence than the current-iteration child below.
        child({ id: "done-backlog", parentId: "e1", category: "done", stateId: "s1", iterationId: "iter-9", position: 1 }),
        // Zone "current": high position in ITS OWN sequence.
        child({ id: "done-current", parentId: "e1", category: "done", stateId: "s1", iterationId: "iter-1", position: 9 }),
      ],
      "iter-1",
    );
    // Current-zone rank (0) beats backlog-zone rank (1) regardless of the
    // raw position numbers — a rank-by-done/rejected bug would have sorted
    // these by position (1 before 9) instead.
    expect(result["e1"].map((c) => c.id)).toEqual(["done-current", "done-backlog"]);
    expect(result["e1"].map((c) => c.location)).toEqual(["done", "done"]);
  });

  it("classifies a story with no current iteration as backlog, never current", () => {
    const result = buildEpicBandChildren(
      [child({ id: "c1", parentId: "e1", stateId: "s1", iterationId: "iter-1" })],
      null,
    );
    expect(result["e1"][0].location).toBe("backlog");
  });

  // spec/data-model.md "Position ordering invariant": position is scoped
  // per zone, not one sequence comparable across zones — so children must
  // group by location first and only sort by position within that group.
  it("groups by location before sorting by position, never comparing position across zones", () => {
    const result = buildEpicBandChildren(
      [
        child({ id: "backlog-hi", parentId: "e1", stateId: "s1", iterationId: "iter-9", position: 0 }),
        child({ id: "current-lo", parentId: "e1", stateId: "s1", iterationId: "iter-1", position: 9 }),
        child({ id: "current-hi", parentId: "e1", stateId: "s1", iterationId: "iter-1", position: 1 }),
        child({ id: "icebox-only", parentId: "e1", stateId: null, position: 0 }),
      ],
      "iter-1",
    );
    // Current (position 1, 9) before Backlog (position 0) before Icebox
    // (position 0) — a raw position sort would put both position-0 rows
    // ahead of Current's position-1 row, which is exactly the bug this
    // grouping avoids.
    expect(result["e1"].map((c) => c.id)).toEqual(["current-hi", "current-lo", "backlog-hi", "icebox-only"]);
  });

  // The band's rollup (buildContainerListItems) is built from every child,
  // any zone, including one whose iteration later finalized and rolled off
  // the live board — this must too, or the band's expanded list silently
  // disagrees with its own progress bar (the exact defect doc-20 §3 fixes).
  it("includes a child of a finalized (rolled-off) iteration, classified by its own category", () => {
    const result = buildEpicBandChildren(
      [child({ id: "history-done", parentId: "e1", category: "done", stateId: "s1", iterationId: "iter-0" })],
      "iter-1",
    );
    expect(result["e1"].map((c) => c.id)).toEqual(["history-done"]);
    expect(result["e1"][0].location).toBe("done");
  });

  it("returns nothing for an epic with no children", () => {
    expect(buildEpicBandChildren([], null)).toEqual({});
  });
});
