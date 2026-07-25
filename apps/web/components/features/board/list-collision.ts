import { closestCenter, pointerWithin, type CollisionDetection } from "@dnd-kit/core";
import { isContainerBlockDroppable } from "@/lib/utils/kanban";

/**
 * The List view's collision strategy, in two phases because the Epics band's
 * rows are not shaped like the flat rows around them.
 *
 * An expanded epic row's rect ENCLOSES its mirrored children, so its centre
 * sits well below its own header. `closestCenter` ranks purely by centre
 * distance, so aiming at that header can resolve to a neighbouring epic — or
 * worse, to a Current/Backlog row, turning an intended attach (which must not
 * move the story at all, doc-20 §5) into a real reschedule. So a story drag
 * asks `pointerWithin` about the epic rows FIRST: whatever the pointer is
 * literally inside is the epic the ring highlights and the drop attaches to
 * (ux-principles principle 7 — the hit target is what you see).
 *
 * Everything else keeps `closestCenter`, which is what a flat sortable list
 * wants. Swapping the whole view to `pointerWithin` would break it: a zone's
 * own <ul> also contains the pointer, so `over.id` would come back as the zone
 * id and the reorder would lose its row anchor.
 *
 * `pointerWithin` returns nothing for a keyboard drag (no pointer
 * coordinates), which falls through to the same `closestCenter` path as before
 * — keyboard reordering is unaffected.
 */
export function listCollisionDetection(
  containerRowIds: ReadonlySet<string>,
  algorithms: { pointerWithin: CollisionDetection; closestCenter: CollisionDetection } = {
    pointerWithin,
    closestCenter,
  },
): CollisionDetection {
  return (args) => {
    const draggingEpicRow = containerRowIds.has(String(args.active.id));

    if (!draggingEpicRow && containerRowIds.size > 0) {
      const onEpicRow = algorithms.pointerWithin({
        ...args,
        droppableContainers: args.droppableContainers.filter((d) => containerRowIds.has(String(d.id))),
      });
      if (onEpicRow.length > 0) {
        return onEpicRow;
      }
    }

    // An epic row only ever competes against the band's own droppables. For a
    // story the band is hidden ENTIRELY here — rows included, not just the
    // block. Attaching is destructive-ish and invisible (the story does not
    // move), so it must be reachable only through the deliberate
    // pointer-inside gesture above. Leaving the rows in this pool would let a
    // story dropped in the gap above Current win an epic on centre distance —
    // the band sits directly above it, and an expanded epic's centre is
    // already low — silently giving the story a parent it was never dragged
    // onto.
    return algorithms.closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((droppable) =>
        draggingEpicRow
          ? isContainerBlockDroppable(String(droppable.id), containerRowIds)
          : !isContainerBlockDroppable(String(droppable.id), containerRowIds),
      ),
    });
  };
}
