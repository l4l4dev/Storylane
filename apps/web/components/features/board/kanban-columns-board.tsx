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
import {
  Circle,
  CircleCheck,
  CircleCheckBig,
  CirclePlay,
  CircleX,
  ListTodo,
  PackageCheck,
  Snowflake,
  type LucideIcon,
} from "lucide-react";
import { dropStory } from "@/app/projects/[id]/board/actions";
import { findContainer, storyById, sumPoints } from "@/lib/utils/board";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  STATE_COLUMNS,
  columnForStory,
  evaluateDrop,
  type KanbanColumnId,
} from "@/lib/utils/kanban";
import { splitBacklogIntoVirtualIterations } from "@/lib/utils/iterations";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryCard } from "./story-card";
import type { BoardStory, IterationMeta } from "./kanban-board";

type ColumnMeta = { label: string; icon: LucideIcon; iconClass: string; tintClass: string };

// Column headers and tints follow the state hues already used by
// STORY_STATE_META (lib/utils/stories.ts) so badges and columns agree.
const COLUMN_META: Record<KanbanColumnId, ColumnMeta> = {
  [ICEBOX_COLUMN_ID]: {
    label: "Icebox",
    icon: Snowflake,
    iconClass: "text-sky-600 dark:text-sky-400",
    tintClass: "bg-sky-50/50 dark:bg-sky-950/20",
  },
  [BACKLOG_COLUMN_ID]: {
    label: "Backlog",
    icon: ListTodo,
    iconClass: "text-muted-foreground",
    tintClass: "bg-muted/40",
  },
  unstarted: {
    label: "Unstarted",
    icon: Circle,
    iconClass: "text-muted-foreground",
    tintClass: "bg-muted/40",
  },
  started: {
    label: "Started",
    icon: CirclePlay,
    iconClass: "text-blue-600 dark:text-blue-400",
    tintClass: "bg-blue-50/60 dark:bg-blue-950/20",
  },
  finished: {
    label: "Finished",
    icon: CircleCheck,
    iconClass: "text-purple-600 dark:text-purple-400",
    tintClass: "bg-purple-50/60 dark:bg-purple-950/20",
  },
  delivered: {
    label: "Delivered",
    icon: PackageCheck,
    iconClass: "text-cyan-600 dark:text-cyan-400",
    tintClass: "bg-cyan-50/60 dark:bg-cyan-950/20",
  },
  accepted: {
    label: "Accepted",
    icon: CircleCheckBig,
    iconClass: "text-green-600 dark:text-green-400",
    tintClass: "bg-green-50/60 dark:bg-green-950/20",
  },
  rejected: {
    label: "Rejected",
    icon: CircleX,
    iconClass: "text-rose-600 dark:text-rose-400",
    tintClass: "bg-rose-50/60 dark:bg-rose-950/20",
  },
};

// The whole card is the drag handle (spec/screens.md "Story card UX": "no
// dedicated drag handle"). A plain click still opens the story normally —
// dnd-kit only intercepts the click once the pointer has actually moved past
// its activation threshold, so it doesn't fire for a stationary click.
function SortableStoryRow({ story, projectId }: { story: BoardStory; projectId: string }) {
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
  stories: BoardStory[];
  projectId: string;
}) {
  const { setNodeRef } = useDroppable({ id: containerId });

  return (
    <SortableContext items={stories.map((s) => s.id)} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
        {stories.map((story) => (
          <SortableStoryRow key={story.id} story={story} projectId={projectId} />
        ))}
      </ul>
    </SortableContext>
  );
}

// Same droppable/sortable behavior as `DroppableStoryList`, but interspersed
// with iteration boundary dividers between `groups` (see spec/velocity.md
// "Marker computation") — the virtual future iterations that would be
// created automatically once the backlog reaches the current one. Dividers
// are decorative only: every story stays in one flat sortable list so drags
// across a boundary work exactly like any other reorder.
function BacklogList({
  groups,
  startingIterationNumber,
  projectId,
}: {
  groups: BoardStory[][];
  startingIterationNumber: number;
  projectId: string;
}) {
  const { setNodeRef } = useDroppable({ id: BACKLOG_COLUMN_ID });
  const allStoryIds = groups.flat().map((s) => s.id);

  return (
    <SortableContext items={allStoryIds} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
        {groups.map((group, groupIndex) => (
          <Fragment key={group[0]?.id ?? groupIndex}>
            {groupIndex > 0 && (
              <li
                aria-hidden
                className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
              >
                <span className="h-px flex-1 bg-border" />
                <span>
                  Iteration #{startingIterationNumber + groupIndex} · {sumPoints(group)} pts
                </span>
                <span className="h-px flex-1 bg-border" />
              </li>
            )}
            {group.map((story) => (
              <SortableStoryRow key={story.id} story={story} projectId={projectId} />
            ))}
          </Fragment>
        ))}
      </ul>
    </SortableContext>
  );
}

// One kanban column: tinted surface, header with state icon / count / point
// sum, independently scrollable body (spec/screens.md "Board layout").
function KanbanColumn({
  columnId,
  stories,
  children,
  composer,
}: {
  columnId: KanbanColumnId;
  stories: BoardStory[];
  children: ReactNode;
  // Quick-add composer, pinned above the scrollable card list so it stays
  // reachable however long the column grows.
  composer?: ReactNode;
}) {
  const meta = COLUMN_META[columnId];
  const Icon = meta.icon;
  const points = sumPoints(stories);

  return (
    <section
      className={`flex h-[calc(100dvh-13rem)] w-72 shrink-0 flex-col rounded-lg border border-border ${meta.tintClass}`}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Icon className={`size-4 shrink-0 ${meta.iconClass}`} aria-hidden />
        <h2 className="text-sm font-semibold">{meta.label}</h2>
        <span className="text-xs text-muted-foreground">{stories.length}</span>
        {points > 0 && <span className="text-xs text-muted-foreground">· {points} pts</span>}
      </header>
      {composer && <div className="px-3 pb-2">{composer}</div>}
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

// State-based kanban layout (see spec/screens.md "Board layout": Kanban
// view). Extracted from the top-level `KanbanBoard`, which now only owns the
// shared header (iteration bar, filters, view toggle) and delegates the
// story area to this component or `BoardListView`.
export function KanbanColumnsBoard({
  projectId,
  currentIteration,
  initialContainers,
  velocity,
  nextVirtualIterationNumber,
  showIcebox,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  // Keyed by KanbanColumnId: backlog, icebox, and one bucket per state column.
  initialContainers: Record<string, BoardStory[]>;
  // Current velocity, used to segment the Backlog column into virtual future
  // iterations (see spec/velocity.md "Marker computation").
  velocity: number;
  nextVirtualIterationNumber: number;
  showIcebox: boolean;
}) {
  // Local order so drops/reorders reflect instantly; server revalidation
  // re-syncs via props afterwards. Reset during render when the prop changes
  // (React's "adjust state on prop change" pattern) rather than via an effect.
  const [containers, setContainers] = useState(initialContainers);
  const [synced, setSynced] = useState(initialContainers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (synced !== initialContainers) {
    setSynced(initialContainers);
    setContainers(initialContainers);
  }

  const sensors = useSensors(
    // The distance threshold keeps plain clicks working on the cards (they
    // open the side peek): without it dnd-kit starts a drag on pointerdown
    // and swallows the click event entirely.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Validates a proposed move with the same pure rules the server re-checks
  // (drag = state transition; see lib/utils/kanban.ts). The source column is
  // derived from the story's own data, not the visual container, so it stays
  // correct even while onDragOver has the card floating in another column.
  function isAllowedMove(storyId: string, targetContainer: string): boolean {
    const story = storyById(synced, storyId);
    if (!story) {
      return false;
    }
    const from = columnForStory(story, currentIteration?.id ?? null);
    return evaluateDrop(story, from, targetContainer as KanbanColumnId).ok;
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
    // Invalid targets don't accept the card visually either — the card
    // simply refuses to enter the column.
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
      setContainers(synced);
      return;
    }

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer || !isAllowedMove(String(active.id), overContainer)) {
      // Snap back: restore the last server-confirmed layout.
      setContainers(synced);
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
    formData.set("target_column", overContainer);
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    startTransition(() => {
      void dropStory(formData);
    });
  }

  const backlogStories = containers[BACKLOG_COLUMN_ID] ?? [];
  const iceboxStories = containers[ICEBOX_COLUMN_ID] ?? [];
  const backlogMarkerGroups = splitBacklogIntoVirtualIterations(backlogStories, velocity);
  const showRejected = (containers.rejected ?? []).length > 0;
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
      <div className="flex gap-3 overflow-x-auto pb-2">
        {showIcebox && (
          <KanbanColumn
            columnId={ICEBOX_COLUMN_ID}
            stories={iceboxStories}
            composer={<QuickAddComposer projectId={projectId} target="icebox" />}
          >
            <DroppableStoryList
              containerId={ICEBOX_COLUMN_ID}
              stories={iceboxStories}
              projectId={projectId}
            />
          </KanbanColumn>
        )}

        <KanbanColumn
          columnId={BACKLOG_COLUMN_ID}
          stories={backlogStories}
          composer={<QuickAddComposer projectId={projectId} target="backlog" />}
        >
          <BacklogList
            groups={backlogMarkerGroups}
            startingIterationNumber={nextVirtualIterationNumber}
            projectId={projectId}
          />
        </KanbanColumn>

        {STATE_COLUMNS.filter((column) => column !== "rejected" || showRejected).map((column) => (
          <KanbanColumn
            key={column}
            columnId={column}
            stories={containers[column] ?? []}
            composer={
              column === "unstarted" ? (
                <QuickAddComposer projectId={projectId} target="unstarted" />
              ) : undefined
            }
          >
            <DroppableStoryList
              containerId={column}
              stories={containers[column] ?? []}
              projectId={projectId}
            />
          </KanbanColumn>
        ))}
      </div>

      {/* Renders the dragged card in a top-level portal (see @dnd-kit docs)
          so it floats above every column instead of being clipped by their
          `overflow-y-auto` bodies — without this the card visually vanished
          behind the target column while dragging. */}
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
