"use client";

import { Fragment, type ReactNode, useState, useTransition } from "react";
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
import { dropStoryInList } from "@/app/projects/[id]/board/actions";
import { findContainer, storyById, sumPoints } from "@/lib/utils/board";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  STATE_COLUMNS,
  evaluateListDrop,
  zoneForStory,
  type ListZoneId,
} from "@/lib/utils/kanban";
import { splitBacklogIntoVirtualIterations } from "@/lib/utils/iterations";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryListRow } from "./story-list-row";
import type { BoardStory, IterationMeta } from "./kanban-board";

// Merges the Kanban view's per-state containers into the List view's three
// zones (see spec/screens.md "Board layout: List view"): every
// current-iteration state becomes one flat, priority-ordered "current" zone.
function toZoneContainers(source: Record<string, BoardStory[]>): Record<string, BoardStory[]> {
  return {
    [ICEBOX_COLUMN_ID]: source[ICEBOX_COLUMN_ID] ?? [],
    current: STATE_COLUMNS.flatMap((column) => source[column] ?? []),
    [BACKLOG_COLUMN_ID]: source[BACKLOG_COLUMN_ID] ?? [],
  };
}

// The whole row is the drag handle, same convention as the Kanban view's
// cards — plain clicks still open the side peek since dnd-kit only takes
// over past the pointer's activation distance.
function SortableListRow({ story, projectId }: { story: BoardStory; projectId: string }) {
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
      <StoryListRow story={story} projectId={projectId} />
    </li>
  );
}

// One zone's section: a title/point-sum header, an optional quick-add
// composer, and a flat sortable list — no independent scroll, no fixed
// width, unlike a Kanban column (this is the point: everything reads as one
// continuous list, see spec/screens.md "Board layout: List view").
function ListSection({
  zoneId,
  title,
  stories,
  projectId,
  composer,
}: {
  zoneId: string;
  title: ReactNode;
  stories: BoardStory[];
  projectId: string;
  composer?: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: zoneId });

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        {title}
        <span className="h-px flex-1 bg-border" />
      </header>
      {composer && <div>{composer}</div>}
      <SortableContext items={stories.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-col gap-1.5">
          {stories.map((story) => (
            <SortableListRow key={story.id} story={story} projectId={projectId} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

// Backlog section: same as `ListSection` but interspersed with the virtual
// iteration boundary dividers (see spec/velocity.md "Marker computation").
// Every story stays in one flat sortable list, so a drag across a boundary
// works exactly like any other reorder — the dividers are decorative only.
function BacklogSection({
  groups,
  startingIterationNumber,
  projectId,
  composer,
}: {
  groups: BoardStory[][];
  startingIterationNumber: number;
  projectId: string;
  composer?: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: BACKLOG_COLUMN_ID });
  const allStoryIds = groups.flat().map((s) => s.id);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Backlog</span>
        <span className="h-px flex-1 bg-border" />
      </header>
      {composer && <div>{composer}</div>}
      <SortableContext items={allStoryIds} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-col gap-1.5">
          {groups.map((group, groupIndex) => (
            <Fragment key={group[0]?.id ?? groupIndex}>
              {groupIndex > 0 && (
                <li aria-hidden className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span>
                    Iteration #{startingIterationNumber + groupIndex} · {sumPoints(group)} pts
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </li>
              )}
              {group.map((story) => (
                <SortableListRow key={story.id} story={story} projectId={projectId} />
              ))}
            </Fragment>
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

// List view (see spec/screens.md "Board layout: List view" — Pivotal
// Tracker parity): the current iteration and the backlog render as one
// continuous, priority-ordered list segmented by iteration lines, instead of
// the Kanban view's physical per-state columns. State renders as a badge on
// each row (`StoryListRow`); one-click transition buttons replace
// drag-to-transition since there's no column to drop onto.
export function BoardListView({
  projectId,
  currentIteration,
  initialContainers,
  velocity,
  nextVirtualIterationNumber,
  showIcebox,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  initialContainers: Record<string, BoardStory[]>;
  velocity: number;
  nextVirtualIterationNumber: number;
  showIcebox: boolean;
}) {
  const [containers, setContainers] = useState(() => toZoneContainers(initialContainers));
  const [synced, setSynced] = useState(initialContainers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (synced !== initialContainers) {
    setSynced(initialContainers);
    setContainers(toZoneContainers(initialContainers));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Derived from the story's own data (via the server-confirmed `synced`
  // snapshot, which is still keyed by state column), not the visual zone —
  // `zoneForStory` only needs the story's own state/iteration_id.
  function isAllowedMove(storyId: string, targetZone: string): boolean {
    const story = storyById(synced, storyId);
    if (!story) {
      return false;
    }
    const from = zoneForStory(story, currentIteration?.id ?? null);
    return evaluateListDrop(story, from, targetZone as ListZoneId).ok;
  }

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
    if (!isAllowedMove(String(active.id), overContainer)) {
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
      setContainers(toZoneContainers(synced));
      return;
    }

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer || !isAllowedMove(String(active.id), overContainer)) {
      setContainers(toZoneContainers(synced));
      return;
    }

    const items = containers[overContainer];
    const oldIndex = items.findIndex((s) => s.id === active.id);
    const newIndex = items.findIndex((s) => s.id === over.id);
    const reordered =
      oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex
        ? arrayMove(items, oldIndex, newIndex)
        : items;

    setContainers((prev) => ({ ...prev, [overContainer]: reordered }));

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("story_id", String(active.id));
    formData.set("target_zone", overContainer);
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    startTransition(() => {
      void dropStoryInList(formData);
    });
  }

  const iceboxStories = containers[ICEBOX_COLUMN_ID] ?? [];
  const currentStories = containers.current ?? [];
  const backlogStories = containers[BACKLOG_COLUMN_ID] ?? [];
  const backlogGroups = splitBacklogIntoVirtualIterations(backlogStories, velocity);
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
      <div className="flex max-w-3xl flex-col gap-6">
        {showIcebox && (
          <ListSection
            zoneId={ICEBOX_COLUMN_ID}
            title={<span className="font-semibold text-foreground">Icebox</span>}
            stories={iceboxStories}
            projectId={projectId}
            composer={<QuickAddComposer projectId={projectId} target="icebox" />}
          />
        )}

        <ListSection
          zoneId="current"
          title={
            <span className="font-semibold text-foreground">
              {currentIteration ? `Iteration #${currentIteration.number} · current` : "Current iteration"} ·{" "}
              {sumPoints(currentStories)} pts
            </span>
          }
          stories={currentStories}
          projectId={projectId}
          composer={<QuickAddComposer projectId={projectId} target="unstarted" />}
        />

        <BacklogSection
          groups={backlogGroups}
          startingIterationNumber={nextVirtualIterationNumber}
          projectId={projectId}
          composer={<QuickAddComposer projectId={projectId} target="backlog" />}
        />
      </div>

      <DragOverlay>
        {activeStory && (
          <div className="max-w-3xl rotate-1 cursor-grabbing">
            <StoryListRow story={activeStory} projectId={projectId} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
