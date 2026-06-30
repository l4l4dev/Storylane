"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderStories } from "@/app/projects/[id]/backlog/actions";
import { StoryCard, type StoryCardData } from "./story-card";

function SortableStory({ story }: { story: StoryCardData }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: story.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-60" : undefined}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Reorder story"
          className="cursor-grab px-1 text-gray-400 hover:text-gray-600"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <div className="flex-1">
          <StoryCard story={story} />
        </div>
      </div>
    </li>
  );
}

export function BacklogBoard({
  projectId,
  stories,
}: {
  projectId: string;
  stories: StoryCardData[];
}) {
  // Local order so the list reflects a drop instantly; server revalidation
  // re-syncs via props afterwards. Reset during render when the prop changes
  // (React's "adjust state on prop change" pattern) rather than via an effect.
  const [items, setItems] = useState(stories);
  const [syncedStories, setSyncedStories] = useState(stories);
  const [, startTransition] = useTransition();

  if (syncedStories !== stories) {
    setSyncedStories(stories);
    setItems(stories);
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = items.findIndex((s) => s.id === active.id);
    const newIndex = items.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);

    const formData = new FormData();
    formData.set("project_id", projectId);
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    startTransition(() => {
      void reorderStories(formData);
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500">No stories match. Create one to get started.</p>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-2">
          {items.map((story) => (
            <SortableStory key={story.id} story={story} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
