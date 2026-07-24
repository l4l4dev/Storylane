"use client";

import { useDraggable } from "@dnd-kit/core";
import type { SplitSourceTask } from "./split-studio";

/**
 * One draggable row for a left-pane source task (Split Studio, doc-18 §7) —
 * drag onto a right card to reassign it. Dims and shows the target's title
 * once assigned — with several tasks, an already-sorted one must read
 * differently from one still needing a home, or the drag session loses
 * track of what's left.
 */
export function SplitSourceTaskRow({
  task,
  assignedToTitle,
}: {
  task: SplitSourceTask;
  assignedToTitle?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const isAssigned = assignedToTitle !== undefined;

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={`cursor-grab rounded border border-border bg-card px-2 py-1.5 text-sm ${
        isDragging ? "opacity-50" : ""
      } ${task.is_done || isAssigned ? "text-muted-foreground" : ""} ${task.is_done ? "line-through" : ""}`}
    >
      {task.title}
      {isAssigned && <span className="ml-1.5 italic">→ {assignedToTitle.trim() || "(untitled)"}</span>}
    </li>
  );
}
