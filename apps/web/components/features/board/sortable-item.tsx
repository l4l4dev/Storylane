"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableItem({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  // TASK-148: tagged so a shared DndContext hosting BOTH cards and My Work's
  // sortable column headers can tell them apart in one onDragStart/End pair
  // (`event.active.data.current?.type`) — every other caller of this
  // component is unaffected, the tag is purely additive.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "card" },
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab active:cursor-grabbing ${className} ${isDragging ? "opacity-60" : ""}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </li>
  );
}
