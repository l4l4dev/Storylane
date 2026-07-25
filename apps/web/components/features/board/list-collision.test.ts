import { describe, expect, it, vi } from "vitest";
import type { CollisionDetection } from "@dnd-kit/core";
import { listCollisionDetection } from "./list-collision";
import { CONTAINER_ROWS_ZONE_ID } from "@/lib/utils/kanban";

// jsdom does no layout, so every rect is 0×0 and dnd-kit's real algorithms
// can't be exercised meaningfully here (same limitation the drag tests note).
// What IS load-bearing is the routing decision — which droppables each phase
// is allowed to see, and that a pointer hit on an epic row wins outright — so
// the two algorithms are injected as spies and asserted on directly.
function args(activeId: string, droppableIds: string[]) {
  return {
    active: { id: activeId },
    droppableContainers: droppableIds.map((id) => ({ id })),
  } as unknown as Parameters<CollisionDetection>[0];
}

function idsSeenBy(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls[0][0].droppableContainers.map((d: { id: string }) => String(d.id));
}

const EPICS = new Set(["e1", "e2"]);
const ALL = [CONTAINER_ROWS_ZONE_ID, "e1", "e2", "icebox", "current", "backlog", "story-1"];

describe("listCollisionDetection", () => {
  it("resolves a story drag to whichever epic row the pointer is inside, ignoring centre distance", () => {
    const pointerWithin = vi.fn(() => [{ id: "e2" }]);
    const closestCenter = vi.fn(() => [{ id: "current" }]);

    const result = listCollisionDetection(EPICS, { pointerWithin, closestCenter } as never)(args("story-1", ALL));

    expect(result).toEqual([{ id: "e2" }]);
    // The expensive part: closestCenter never ran, so an expanded epic's
    // centre — which sits below its own header — cannot steal the drop.
    expect(closestCenter).not.toHaveBeenCalled();
    expect(idsSeenBy(pointerWithin)).toEqual(["e1", "e2"]);
  });

  it("falls back to closestCenter when the pointer is over no epic row", () => {
    const pointerWithin = vi.fn(() => []);
    const closestCenter = vi.fn(() => [{ id: "backlog" }]);

    const result = listCollisionDetection(EPICS, { pointerWithin, closestCenter } as never)(args("story-1", ALL));

    expect(result).toEqual([{ id: "backlog" }]);
    // The whole band is hidden from a story here, rows included: attach must
    // only ever come from the pointer-inside gesture, never from winning a
    // centre-distance contest in the gap above Current (doc-20 §5).
    expect(idsSeenBy(closestCenter)).toEqual(["icebox", "current", "backlog", "story-1"]);
  });

  // A keyboard drag has no pointer coordinates, so dnd-kit's pointerWithin
  // returns nothing — the ordinary path must still work.
  it("keeps keyboard drags on the ordinary path", () => {
    const pointerWithin = vi.fn(() => []);
    const closestCenter = vi.fn(() => [{ id: "icebox" }]);

    expect(listCollisionDetection(EPICS, { pointerWithin, closestCenter } as never)(args("story-1", ALL))).toEqual([
      { id: "icebox" },
    ]);
  });

  it("leaves an epic-row drag competing only against the band, never pointer-first", () => {
    const pointerWithin = vi.fn(() => [{ id: "e2" }]);
    const closestCenter = vi.fn(() => [{ id: "e2" }]);

    listCollisionDetection(EPICS, { pointerWithin, closestCenter } as never)(args("e1", ALL));

    expect(pointerWithin).not.toHaveBeenCalled();
    expect(idsSeenBy(closestCenter)).toEqual([CONTAINER_ROWS_ZONE_ID, "e1", "e2"]);
  });

  it("skips the epic phase entirely when the project has no epics", () => {
    const pointerWithin = vi.fn(() => []);
    const closestCenter = vi.fn(() => [{ id: "current" }]);

    listCollisionDetection(new Set(), { pointerWithin, closestCenter } as never)(args("story-1", ALL));

    expect(pointerWithin).not.toHaveBeenCalled();
  });
});
