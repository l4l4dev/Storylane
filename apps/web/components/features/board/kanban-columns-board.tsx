"use client";

import { type ReactNode, useState, useTransition } from "react";
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
  PackageCheck,
  type LucideIcon,
} from "lucide-react";
import { dropStory } from "@/app/projects/[id]/board/actions";
import { findContainer, reorderContainer, storyById, sumPoints } from "@/lib/utils/board";
import { STATE_COLUMNS, columnForStory, evaluateDrop, type KanbanColumnId, type StateColumnId } from "@/lib/utils/kanban";
import { matchesStoryFilter, type StoryFilter } from "@/lib/utils/stories";
import { MutationErrorBanner } from "./mutation-error-banner";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryCard } from "./story-card";
import type { BoardStory, IterationMeta } from "./kanban-board";

type ColumnMeta = { label: string; icon: LucideIcon; iconClass: string; tintClass: string };

// Column headers and tints follow the state hues already used by
// STORY_STATE_META (lib/utils/stories.ts) so badges and columns agree.
const COLUMN_META: Record<StateColumnId, ColumnMeta> = {
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

// One kanban column: tinted surface, header with state icon / count / point
// sum, independently scrollable body (spec/screens.md "Board layout").
function KanbanColumn({
  columnId,
  stories,
  children,
  composer,
}: {
  columnId: StateColumnId;
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

// State-based kanban layout, scoped to the current iteration only (see
// spec/screens.md "Board layout": Kanban view — Backlog/Icebox management
// lives exclusively in the List view now). Extracted from the top-level
// `KanbanBoard`, which owns the shared header (iteration bar, filters, view
// toggle) and delegates the story area to this component or `BoardListView`.
export function KanbanColumnsBoard({
  projectId,
  currentIteration,
  initialContainers,
  filter,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  // Keyed by KanbanColumnId: only the state-column buckets are read here —
  // this same object's backlog/icebox buckets are what `BoardListView` reads.
  // Unfiltered — see `visibleContainers` below for the rendered, filtered
  // view.
  initialContainers: Record<string, BoardStory[]>;
  filter: StoryFilter;
}) {
  // Local order so drops/reorders reflect instantly; server revalidation
  // re-syncs via props afterwards. Reset during render when the prop changes
  // (React's "adjust state on prop change" pattern) rather than via an effect.
  const [containers, setContainers] = useState(initialContainers);
  const [synced, setSynced] = useState(initialContainers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (synced !== initialContainers) {
    setSynced(initialContainers);
    setContainers(initialContainers);
  }

  // Rendered (visible) view only — `containers` itself stays the full,
  // unfiltered set so drag math (below) and the top bar's committed points
  // (KanbanBoard) never depend on which filter is active.
  const visibleContainers: Record<string, BoardStory[]> = {};
  for (const [column, stories] of Object.entries(containers)) {
    visibleContainers[column] = stories.filter((story) => matchesStoryFilter(story, filter));
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

    // Reorders against the *full* column (containers), not just what's
    // rendered under the active filter — active.id/over.id always belong to
    // visible rows, but relocating them within the full list is what keeps a
    // hidden row's relative position intact.
    const items = containers[overContainer];
    const reordered = reorderContainer(items, String(active.id), String(over.id));

    setContainers((prev) => ({ ...prev, [overContainer]: reordered }));
    setDragError(null);

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("story_id", String(active.id));
    formData.set("target_column", overContainer);
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    // Awaited and caught — the server re-derives the transition from the
    // story's *current* state (see dropStory), so a stale client
    // (e.g. another user already accepted this story) gets a rejection
    // here even though the client-side isAllowedMove check above passed.
    // Un-caught, the optimistic reorder above would never be reverted.
    startTransition(async () => {
      try {
        await dropStory(formData);
      } catch (err) {
        setContainers(synced);
        setDragError(err instanceof Error ? err.message : "Failed to move the story");
      }
    });
  }

  // Based on the visible set — an empty column that only has content hidden
  // by the active filter shouldn't clutter the board.
  const showRejected = (visibleContainers.rejected ?? []).length > 0;
  const activeStory = activeId ? storyById(containers, activeId) : undefined;

  return (
    <DndContext
      id="kanban-columns-board"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {dragError && <MutationErrorBanner message={dragError} onDismiss={() => setDragError(null)} />}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STATE_COLUMNS.filter((column) => column !== "rejected" || showRejected).map((column) => (
          <KanbanColumn
            key={column}
            columnId={column}
            stories={visibleContainers[column] ?? []}
            composer={
              column === "unstarted" ? (
                <QuickAddComposer projectId={projectId} target="unstarted" />
              ) : undefined
            }
          >
            <DroppableStoryList
              containerId={column}
              stories={visibleContainers[column] ?? []}
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
