"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useDroppable,
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
import { dropStoryFree } from "@/app/projects/[id]/board/actions";
import { findContainer, storyById, sumPoints } from "@/lib/utils/board";
import { useProjectBoardRealtime } from "@/lib/supabase/realtime";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryCard, type StoryCardData } from "./story-card";

export type CustomStatus = { id: string; name: string; color: string; position: number; is_done: boolean };

// Free-mode board (Task 14, spec/screens.md): a pure Trello-style kanban.
// Columns come from the project's `custom_statuses` rows, any card can move
// to any column (no state machine), and there is no iteration bar, List
// view, or Icebox. Shares the drag scaffolding conventions of
// `KanbanColumnsBoard`, but validation is only "the container exists".
export function FreeBoard({
  projectId,
  statuses,
  initialContainers,
  toolbar,
}: {
  projectId: string;
  statuses: CustomStatus[];
  // Keyed by custom_statuses.id.
  initialContainers: Record<string, StoryCardData[]>;
  toolbar?: ReactNode;
}) {
  const [containers, setContainers] = useState(initialContainers);
  const [synced, setSynced] = useState(initialContainers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (synced !== initialContainers) {
    setSynced(initialContainers);
    setContainers(initialContainers);
  }

  useProjectBoardRealtime(projectId, () => router.refresh());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) {
      return;
    }

    const activeContainer = findContainer(containers, String(active.id));
    const overContainer = findContainer(containers, String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return;
    }

    setContainers((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.findIndex((s) => s.id === active.id);
      const overIndex = overItems.findIndex((s) => s.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;
      const moved = activeItems[activeIndex];
      if (!moved) {
        return prev;
      }

      return {
        ...prev,
        [activeContainer]: activeItems.filter((s) => s.id !== active.id),
        [overContainer]: [...overItems.slice(0, insertAt), moved, ...overItems.slice(insertAt)],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) {
      setContainers(synced);
      return;
    }

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer) {
      setContainers(synced);
      return;
    }

    const items = containers[overContainer];
    const oldIndex = items.findIndex((s) => s.id === active.id);
    const newIndex = items.findIndex((s) => s.id === over.id);
    const reordered =
      oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex ? arrayMove(items, oldIndex, newIndex) : items;

    setContainers((prev) => ({ ...prev, [overContainer]: reordered }));

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("story_id", String(active.id));
    formData.set("status_id", overContainer);
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    startTransition(() => {
      void dropStoryFree(formData);
    });
  }

  const activeStory = activeId ? storyById(containers, activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {toolbar && <div className="mb-4 flex items-center justify-end gap-2">{toolbar}</div>}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {statuses.map((status) => (
          <FreeColumn
            key={status.id}
            status={status}
            stories={containers[status.id] ?? []}
            projectId={projectId}
          />
        ))}
      </div>

      <DragOverlay>
        {activeStory && (
          <div className="w-64 rotate-1 cursor-grabbing">
            <StoryCard story={activeStory} projectId={projectId} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function FreeColumn({
  status,
  stories,
  projectId,
}: {
  status: CustomStatus;
  stories: StoryCardData[];
  projectId: string;
}) {
  const { setNodeRef } = useDroppable({ id: status.id });
  const points = sumPoints(stories);

  return (
    <section className="flex h-[calc(100dvh-13rem)] w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} aria-hidden />
        <h2 className="truncate text-sm font-semibold">{status.name}</h2>
        <span className="text-xs text-muted-foreground">{stories.length}</span>
        {points > 0 && <span className="text-xs text-muted-foreground">· {points} pts</span>}
      </header>
      <div className="px-3 pb-2">
        <QuickAddComposer projectId={projectId} target={{ customStatusId: status.id }} />
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
        <SortableContext items={stories.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
            {stories.map((story) => (
              <SortableFreeCard key={story.id} story={story} projectId={projectId} />
            ))}
          </ul>
        </SortableContext>
      </div>
    </section>
  );
}

function SortableFreeCard({ story, projectId }: { story: StoryCardData; projectId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: story.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? "opacity-60" : ""}`}
      {...attributes}
      {...listeners}
    >
      <StoryCard story={story} projectId={projectId} />
    </li>
  );
}
