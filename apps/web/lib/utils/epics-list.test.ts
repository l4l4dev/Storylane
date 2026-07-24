import { describe, expect, it } from "vitest";
import { buildContainerAccordionRows, buildContainerListItems } from "./epics-list";

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

// doc-18 §9: the List view's Icebox accordion — a container's Icebox
// children (stateId null) nest under it; children with a state stay in
// their own zone (Current/Backlog), unaffected by this grouping.
describe("buildContainerAccordionRows", () => {
  it("includes only Icebox (stateId null) children, sorted by position, in iceboxChildIds", () => {
    const rows = buildContainerAccordionRows(
      [{ id: "e1", number: 5, title: "Epic", epicColor: "#f00" }],
      [
        { id: "c1", parentId: "e1", stateId: null, position: 2, category: null, points: 1 },
        { id: "c2", parentId: "e1", stateId: null, position: 1, category: null, points: 2 },
        { id: "c3", parentId: "e1", stateId: "started-id", position: 3, category: "in_progress", points: 3 },
      ],
    );
    expect(rows[0].iceboxChildIds).toEqual(["c2", "c1"]);
  });

  it("still rolls up ALL children (any zone) for the progress bar, not just Icebox ones", () => {
    const rows = buildContainerAccordionRows(
      [{ id: "e1", number: 5, title: "Epic", epicColor: null }],
      [
        { id: "c1", parentId: "e1", stateId: null, position: 1, category: null, points: 2 },
        { id: "c2", parentId: "e1", stateId: "s1", position: 2, category: "done", points: 3 },
      ],
    );
    expect(rows[0].rollup).toEqual({
      headline: "in_progress",
      points: 5,
      breakdown: { unstarted: 0, in_progress: 0, done: 1, rejected: 0, icebox: 1 },
    });
  });

  it("empty iceboxChildIds for a container with no Icebox children", () => {
    const rows = buildContainerAccordionRows(
      [{ id: "e1", number: 1, title: "Epic", epicColor: null }],
      [{ id: "c1", parentId: "e1", stateId: "s1", position: 1, category: "done", points: 1 }],
    );
    expect(rows[0].iceboxChildIds).toEqual([]);
  });
});
