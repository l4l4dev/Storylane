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
import { BACKLOG_CONTAINER_ID, ICEBOX_CONTAINER_ID, sumPoints } from "@/lib/utils/board";
import { BoardSidebar, DEFAULT_BOARD_PANELS, type BoardPanelId } from "./board-sidebar";
import { StoryCard, type StoryCardData } from "./story-card";

export { BACKLOG_CONTAINER_ID, ICEBOX_CONTAINER_ID };

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

// The whole card is the drag handle (spec/screens.md "Story card UX": "no
// dedicated drag handle"). A plain click still opens the story link/buttons
// normally — dnd-kit only intercepts the click once the pointer has actually
// moved past its activation threshold, so it doesn't fire for a stationary click.
function SortableStoryRow({ story, projectId }: { story: StoryCardData; projectId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: story.id,
  });

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

function DroppableStoryList({
  containerId,
  stories,
  projectId,
}: {
  containerId: string;
  stories: StoryCardData[];
  projectId: string;
}) {
  const { setNodeRef } = useDroppable({ id: containerId });

  return (
    <SortableContext items={stories.map((s) => s.id)} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className="flex min-h-[2.5rem] flex-col gap-2">
        {stories.map((story) => (
          <SortableStoryRow key={story.id} story={story} projectId={projectId} />
        ))}
      </ul>
    </SortableContext>
  );
}

// Each panel is an independently scrollable column (spec/screens.md "Board
// layout"). `w-80 shrink-0` keeps columns a fixed width so extra panels grow
// the board horizontally instead of squeezing existing ones.
function PanelColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex h-[calc(100vh-14rem)] w-80 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <h2 className="text-sm font-semibold text-gray-500">{title}</h2>
      {children}
    </section>
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
    <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Iteration #{iteration.number}</h3>
          {isCurrent && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              Current
            </span>
          )}
          <span className="text-xs text-gray-500">{sumPoints(stories)} pts</span>
        </div>
      </div>
      <p className="mb-2 text-xs text-gray-500">
        {iteration.start_date} – {iteration.end_date}
      </p>

      <form action={updateIterationGoal} className="mb-3 flex items-center gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="iteration_id" value={iteration.id} />
        <input
          name="goal"
          placeholder="Sprint goal"
          defaultValue={iteration.goal ?? ""}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-zinc-800"
        />
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
        >
          Save
        </button>
      </form>

      {stories.length === 0 && (
        <p className="mb-3 text-sm text-gray-500">No stories assigned yet.</p>
      )}
      <DroppableStoryList containerId={iteration.id} stories={stories} projectId={projectId} />

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
  projectId,
}: {
  iteration: IterationMeta;
  stories: StoryCardData[];
  projectId: string;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-zinc-900/40">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-gray-600 dark:text-gray-300">Iteration #{iteration.number}</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-zinc-800 dark:text-gray-300">
          {iteration.velocity ?? 0} pts
        </span>
      </div>
      <p className="mb-2 text-xs text-gray-500">
        {iteration.start_date} – {iteration.end_date}
      </p>
      {iteration.goal && (
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">{iteration.goal}</p>
      )}
      {stories.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {stories.map((story) => (
            <li key={story.id}>
              <StoryCard story={story} projectId={projectId} />
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
  currentToolbar,
  epicsPanel,
}: {
  projectId: string;
  today: string;
  iterations: IterationMeta[];
  // Keyed by BACKLOG_CONTAINER_ID, ICEBOX_CONTAINER_ID, or an iteration id.
  initialContainers: Record<string, StoryCardData[]>;
  doneIterationStories: Record<string, StoryCardData[]>;
  backlogToolbar?: ReactNode;
  backlogFilters?: ReactNode;
  currentToolbar?: ReactNode;
  epicsPanel?: ReactNode;
}) {
  // Local order so drops/reorders reflect instantly; server revalidation
  // re-syncs via props afterwards. Reset during render when the prop changes
  // (React's "adjust state on prop change" pattern) rather than via an effect.
  const [containers, setContainers] = useState(initialContainers);
  const [synced, setSynced] = useState(initialContainers);
  const [, startTransition] = useTransition();
  const [enabledPanels, setEnabledPanels] = useState<ReadonlySet<BoardPanelId>>(DEFAULT_BOARD_PANELS);

  if (synced !== initialContainers) {
    setSynced(initialContainers);
    setContainers(initialContainers);
  }

  function togglePanel(panel: BoardPanelId) {
    setEnabledPanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) {
        next.delete(panel);
      } else {
        next.add(panel);
      }
      return next;
    });
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
    formData.set("destination_container", overContainer);
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    startTransition(() => {
      void moveStory(formData);
    });
  }

  const editableIterations = iterations.filter((iteration) => iteration.state !== "done");
  const doneIterations = iterations.filter((iteration) => iteration.state === "done");
  const backlogStories = containers[BACKLOG_CONTAINER_ID] ?? [];
  const iceboxStories = containers[ICEBOX_CONTAINER_ID] ?? [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4">
        <BoardSidebar enabled={enabledPanels} onToggle={togglePanel} />

        <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
          {enabledPanels.has("current") && (
            <PanelColumn title="Current">
              {currentToolbar}
              {editableIterations.length === 0 && (
                <p className="text-sm text-gray-500">No active iteration.</p>
              )}
              <div className="flex flex-col gap-4">
                {editableIterations.map((iteration) => (
                  <IterationSection
                    key={iteration.id}
                    iteration={iteration}
                    stories={containers[iteration.id] ?? []}
                    projectId={projectId}
                    today={today}
                  />
                ))}
              </div>
            </PanelColumn>
          )}

          {enabledPanels.has("backlog") && (
            <PanelColumn title="Backlog">
              {backlogToolbar}
              {backlogFilters}
              {backlogStories.length === 0 && (
                <p className="text-sm text-gray-500">Backlog is empty.</p>
              )}
              <DroppableStoryList
                containerId={BACKLOG_CONTAINER_ID}
                stories={backlogStories}
                projectId={projectId}
              />
            </PanelColumn>
          )}

          {enabledPanels.has("icebox") && (
            <PanelColumn title="Icebox">
              {iceboxStories.length === 0 && (
                <p className="text-sm text-gray-500">Icebox is empty.</p>
              )}
              <DroppableStoryList
                containerId={ICEBOX_CONTAINER_ID}
                stories={iceboxStories}
                projectId={projectId}
              />
            </PanelColumn>
          )}

          {enabledPanels.has("done") && (
            <PanelColumn title="Done">
              {doneIterations.length === 0 && (
                <p className="text-sm text-gray-500">No completed iterations yet.</p>
              )}
              <div className="flex flex-col gap-4">
                {doneIterations.map((iteration) => (
                  <DoneIterationSection
                    key={iteration.id}
                    iteration={iteration}
                    stories={doneIterationStories[iteration.id] ?? []}
                    projectId={projectId}
                  />
                ))}
              </div>
            </PanelColumn>
          )}

          {enabledPanels.has("epics") && <PanelColumn title="Epics">{epicsPanel}</PanelColumn>}
        </div>
      </div>
    </DndContext>
  );
}
