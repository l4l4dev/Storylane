"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableItem({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  // TASK-148: tagged so a shared DndContext hosting BOTH cards and My Work's
  // sortable column headers can tell them apart in one onDragStart/End pair
  // (`event.active.data.current?.type`) — every other caller of this
  // component is unaffected, the tag is purely additive.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "card" },
  });

  // dnd-kit's `attributes` (role="button", tabIndex, aria-roledescription)
  // are deliberately NOT spread here (doc-17 #43): every card wraps its own
  // <Link> to the story, and applying them to this <li> nested a link inside
  // a button role and gave each card two tab stops. `listeners` alone still
  // covers pointer/touch drag (onPointerDown doesn't need focusability), so
  // mouse/touch dragging is unaffected.
  // ponytail: this drops keyboard-initiated CARD dragging (mouse/touch only)
  // — columns keep their own dedicated, correctly-tabbable grip button
  // (my-work-sections.tsx MyWorkColumnShell), so if card reordering needs a
  // keyboard path later, give it the same treatment: a small separate handle
  // carrying `attributes`, not the whole row.
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab active:cursor-grabbing ${className} ${isDragging ? "opacity-60" : ""}`}
      {...listeners}
    >
      {children}
    </li>
  );
}
