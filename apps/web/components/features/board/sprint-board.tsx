"use client";

import { type ReactNode, useState, useTransition } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
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
import { finalizeIteration, moveStory, updateIterationGoal } from "@/app/projects/[id]/board/actions";
import { isCurrentIteration } from "@/lib/utils/iterations";
import { sumPoints } from "@/lib/utils/board";
import { StoryCard, type StoryCardData } from "./story-card";

export const BACKLOG_CONTAINER_ID = "backlog";

export type IterationMeta = {
  id: string;
  number: number;
  goal: string | null;
  start_date: string;
  end_date: string;
  velocity: number | null;
  state: string;
};

// Finds which container currently holds `itemId` — either a container being
// hovered directly (its droppable id equals itemId, relevant for empty
// containers) or the container whose story list contains it.
function findContainer(
  containers: Record<string, StoryCardData[]>,
  itemId: string,
): string | undefined {
  if (itemId in containers) {
    return itemId;
  }
  return Object.keys(containers).find((key) => containers[key].some((s) => s.id === itemId));
}

function SortableStoryRow({ story }: { story: StoryCardData }) {
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

function DroppableStoryList({
  containerId,
  stories,
}: {
  containerId: string;
  stories: StoryCardData[];
}) {
  const { setNodeRef } = useDroppable({ id: containerId });

  return (
    <SortableContext items={stories.map((s) => s.id)} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className="flex min-h-[2.5rem] flex-col gap-2">
        {stories.map((story) => (
          <SortableStoryRow key={story.id} story={story} />
        ))}
      </ul>
    </SortableContext>
  );
}

function IterationSection({
  iteration,
  stories,
  projectId,
  today,
}: {
  iteration: IterationMeta;
  stories: StoryCardData[];
  projectId: string;
  today: string;
}) {
  const isCurrent = isCurrentIteration(iteration, today);

  return (
    <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Iteration #{iteration.number}</h2>
          {isCurrent && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              Current
            </span>
          )}
          <span className="text-xs text-gray-500">{sumPoints(stories)} pts</span>
        </div>
        <span className="text-xs text-gray-500">
          {iteration.start_date} – {iteration.end_date}
        </span>
      </div>

      <form action={updateIterationGoal} className="mb-3 flex items-center gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="iteration_id" value={iteration.id} />
        <input
          name="goal"
          placeholder="Sprint goal"
          defaultValue={iteration.goal ?? ""}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-zinc-800"
        />
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
        >
          Save
        </button>
      </form>

      {stories.length === 0 && (
        <p className="mb-3 text-sm text-gray-500">No stories assigned yet.</p>
      )}
      <DroppableStoryList containerId={iteration.id} stories={stories} />

      <form action={finalizeIteration} className="mt-3">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="iteration_id" value={iteration.id} />
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
        >
          Mark as done
        </button>
      </form>
    </section>
  );
}

function DoneIterationSection({
  iteration,
  stories,
}: {
  iteration: IterationMeta;
  stories: StoryCardData[];
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-zinc-900/40">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-600 dark:text-gray-300">
            Iteration #{iteration.number}
          </h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-zinc-800 dark:text-gray-300">
            Done · {iteration.velocity ?? 0} pts
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {iteration.start_date} – {iteration.end_date}
        </span>
      </div>
      {iteration.goal && (
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">{iteration.goal}</p>
      )}
      {stories.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {stories.map((story) => (
            <li key={story.id}>
              <StoryCard story={story} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">No stories were completed.</p>
      )}
    </section>
  );
}

export function SprintBoard({
  projectId,
  today,
  iterations,
  initialContainers,
  doneIterationStories,
  backlogToolbar,
  backlogFilters,
}: {
  projectId: string;
  today: string;
  iterations: IterationMeta[];
  initialContainers: Record<string, StoryCardData[]>;
  doneIterationStories: Record<string, StoryCardData[]>;
  backlogToolbar?: ReactNode;
  backlogFilters?: ReactNode;
}) {
  // Local order so drops/reorders reflect instantly; server revalidation
  // re-syncs via props afterwards. Reset during render when the prop changes
  // (React's "adjust state on prop change" pattern) rather than via an effect.
  const [containers, setContainers] = useState(initialContainers);
  const [synced, setSynced] = useState(initialContainers);
  const [, startTransition] = useTransition();

  if (synced !== initialContainers) {
    setSynced(initialContainers);
    setContainers(initialContainers);
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    const { active, over } = event;
    if (!over) {
      return;
    }

    const activeContainer = findContainer(containers, String(active.id));
    const overContainer = findContainer(containers, String(over.id));
    if (!activeContainer || !overContainer) {
      return;
    }

    const items = containers[overContainer];
    const oldIndex = items.findIndex((s) => s.id === active.id);
    const newIndex = items.findIndex((s) => s.id === over.id);
    // oldIndex can be -1 if `containers` hasn't caught up with the latest
    // active/over pair yet (rapid pointer events during onDragOver's own state
    // updates). arrayMove treats negative indices as wrap-around rather than a
    // no-op, so guard against it explicitly instead of silently relocating an
    // unrelated story.
    const reordered =
      oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex
        ? arrayMove(items, oldIndex, newIndex)
        : items;

    setContainers((prev) => ({ ...prev, [overContainer]: reordered }));

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("story_id", String(active.id));
    formData.set(
      "destination_iteration_id",
      overContainer === BACKLOG_CONTAINER_ID ? "" : overContainer,
    );
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    startTransition(() => {
      void moveStory(formData);
    });
  }

  const editableIterations = iterations.filter((iteration) => iteration.state !== "done");
  const doneIterations = iterations.filter((iteration) => iteration.state === "done");
  const backlogStories = containers[BACKLOG_CONTAINER_ID] ?? [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-6">
        {editableIterations.map((iteration) => (
          <IterationSection
            key={iteration.id}
            iteration={iteration}
            stories={containers[iteration.id] ?? []}
            projectId={projectId}
            today={today}
          />
        ))}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Backlog</h2>
            {backlogToolbar}
          </div>
          {backlogFilters && <div className="mb-3">{backlogFilters}</div>}
          {backlogStories.length === 0 && (
            <p className="mb-3 text-sm text-gray-500">Backlog is empty.</p>
          )}
          <DroppableStoryList containerId={BACKLOG_CONTAINER_ID} stories={backlogStories} />
        </section>

        {doneIterations.length > 0 && (
          <div className="flex flex-col gap-6 border-t border-gray-200 pt-6 dark:border-gray-800">
            <h2 className="text-lg font-semibold text-gray-500">Done</h2>
            {doneIterations.map((iteration) => (
              <DoneIterationSection
                key={iteration.id}
                iteration={iteration}
                stories={doneIterationStories[iteration.id] ?? []}
              />
            ))}
          </div>
        )}
      </div>
    </DndContext>
  );
}
