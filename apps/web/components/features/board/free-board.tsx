"use client";

import { Fragment, type ReactNode, useState, useTransition } from "react";
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
import { MoreHorizontal } from "lucide-react";
import { dropStoryFree } from "@/app/projects/[id]/board/actions";
import { setStatusWipLimit } from "@/app/projects/[id]/settings/actions";
import {
  findContainer,
  isOverWipLimit,
  laneContainerKey,
  parseLaneContainerKey,
  storyById,
  sumPoints,
} from "@/lib/utils/board";
import { groupDoneStories } from "@/lib/utils/focus";
import { useProjectBoardRealtime } from "@/lib/supabase/realtime";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MutationErrorBanner } from "./mutation-error-banner";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryCard, type StoryCardData } from "./story-card";

export type CustomStatus = {
  id: string;
  name: string;
  color: string;
  position: number;
  is_done: boolean;
  wip_limit: number | null;
};

// TASK-16.3: an optional horizontal lane (spec/screens.md "Swimlanes").
export type Swimlane = {
  id: string;
  name: string;
  position: number;
};

// TASK-16.1: is_done columns show when each card was completed, grouped
// under date headers — completed_at is DB-trigger-maintained (see
// 20260709000005_free_mode_completed_at.sql), set whenever a story moves
// into an is_done column, cleared when it moves out.
// TASK-16.3: also carries swimlane_id so a lane-less board can be told
// apart from a card explicitly sitting in the No lane band.
type FreeStoryCardData = StoryCardData & { completed_at: string | null; swimlane_id: string | null };

function todayLocalDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Free-mode board (Task 14, spec/screens.md): a pure Trello-style kanban.
// Columns come from the project's `custom_statuses` rows, any card can move
// to any column (no state machine), and there is no iteration bar, List
// view, or Icebox. Shares the drag scaffolding conventions of
// `KanbanColumnsBoard`, but validation is only "the container exists".
export function FreeBoard({
  projectId,
  statuses,
  lanes,
  initialContainers,
  toolbar,
}: {
  projectId: string;
  statuses: CustomStatus[];
  // TASK-16.3: when non-empty, `initialContainers` is keyed by
  // `laneContainerKey(statusId, laneId)` instead of a bare status id.
  lanes: Swimlane[];
  initialContainers: Record<string, FreeStoryCardData[]>;
  toolbar?: ReactNode;
}) {
  const hasLanes = lanes.length > 0;
  const [containers, setContainers] = useState(initialContainers);
  const [synced, setSynced] = useState(initialContainers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
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
    setDragError(null);

    const { statusId, laneId } = hasLanes
      ? parseLaneContainerKey(overContainer)
      : { statusId: overContainer, laneId: null };

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("story_id", String(active.id));
    formData.set("status_id", statusId);
    // Its absence (no-lanes board) is how the server tells "don't touch the
    // lane column" apart from an explicit move into No lane ("").
    if (hasLanes) {
      formData.set("swimlane_id", laneId ?? "");
    }
    reordered.forEach((s) => formData.append("ordered_ids", s.id));
    // TASK-22: awaited and caught so a failed/RLS-filtered write reverts
    // the optimistic move and surfaces an error instead of leaving the
    // card in a column the server never actually applied.
    startTransition(async () => {
      try {
        await dropStoryFree(formData);
      } catch (err) {
        setContainers(synced);
        setDragError(err instanceof Error ? err.message : "Failed to move the story");
      }
    });
  }

  const activeStory = activeId ? storyById(containers, activeId) : undefined;

  return (
    <DndContext
      id="free-board"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {toolbar && <div className="mb-4 flex items-center justify-end gap-2">{toolbar}</div>}
      {dragError && <MutationErrorBanner message={dragError} onDismiss={() => setDragError(null)} />}

      {statuses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No board columns yet. Add one in Settings → Board statuses.
        </p>
      ) : hasLanes ? (
        <FreeBoardLanes statuses={statuses} lanes={lanes} containers={containers} projectId={projectId} />
      ) : (
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
      )}

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

// Column header content (dot, name, count/limit, points, WIP menu) — shared
// between the single-band board's per-column header and the lanes layout's
// column-header row (TASK-16.3), where it's rendered once for the whole
// column and `stories` is the sum across every lane band.
function ColumnHeaderContent({
  status,
  stories,
  projectId,
}: {
  status: CustomStatus;
  stories: FreeStoryCardData[];
  projectId: string;
}) {
  const points = sumPoints(stories);
  // TASK-16.2: a soft WIP limit — over it is purely a warning color, drops
  // are never blocked (spec/screens.md "Free mode board").
  const overWipLimit = isOverWipLimit(stories.length, status.wip_limit);

  return (
    <>
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} aria-hidden />
      <h2 className="truncate text-sm font-semibold">{status.name}</h2>
      <span className={`text-xs ${overWipLimit ? "font-semibold text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
        {status.wip_limit != null ? `${stories.length} / ${status.wip_limit}` : stories.length}
      </span>
      {points > 0 && <span className="text-xs text-muted-foreground">· {points} pts</span>}
      <WipLimitMenu projectId={projectId} statusId={status.id} currentLimit={status.wip_limit} />
    </>
  );
}

function FreeColumn({
  status,
  stories,
  projectId,
}: {
  status: CustomStatus;
  stories: FreeStoryCardData[];
  projectId: string;
}) {
  const { setNodeRef } = useDroppable({ id: status.id });

  // TASK-16.1: is_done columns group their cards under date headers
  // (Today/Yesterday/date), newest first — still one flat SortableContext
  // (headers interspersed, same pattern as the Backlog's virtual-iteration
  // groups in board-list-view.tsx) so cards stay draggable in and out, per
  // spec/screens.md "any-to-any drag" — free mode has no read-only columns.
  const doneGroups = status.is_done
    ? groupDoneStories(
        stories.map((story) => ({
          story,
          completedDateKey: story.completed_at ? localDateKey(story.completed_at) : todayLocalDateKey(),
        })),
        todayLocalDateKey(),
      )
    : null;

  return (
    <section className="flex h-[calc(100dvh-13rem)] w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <ColumnHeaderContent status={status} stories={stories} projectId={projectId} />
      </header>
      <div className="px-3 pb-2">
        <QuickAddComposer projectId={projectId} target={{ customStatusId: status.id }} />
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
        <SortableContext
          items={doneGroups ? doneGroups.flatMap((g) => g.stories.map(({ story }) => story.id)) : stories.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
            {doneGroups
              ? doneGroups.map((group) => (
                  <Fragment key={group.dateKey}>
                    <li className="text-xs font-semibold text-muted-foreground">{group.label}</li>
                    {group.stories.map(({ story }) => (
                      <SortableFreeCard key={story.id} story={story} projectId={projectId} />
                    ))}
                  </Fragment>
                ))
              : stories.map((story) => <SortableFreeCard key={story.id} story={story} projectId={projectId} />)}
          </ul>
        </SortableContext>
      </div>
    </section>
  );
}

// TASK-16.3: the lanes layout (spec/screens.md "Swimlanes") — a column
// header row rendered once, then one horizontal band per lane stacked below
// it, each holding its own per-column droppable cell. The No lane band is
// always shown first, even when empty, so it's always a valid drop target
// for clearing a card's swimlane_id (per spec, new cards from a column's
// quick-add always start there, so it must never be buried under named
// lanes further down).
function FreeBoardLanes({
  statuses,
  lanes,
  containers,
  projectId,
}: {
  statuses: CustomStatus[];
  lanes: Swimlane[];
  containers: Record<string, FreeStoryCardData[]>;
  projectId: string;
}) {
  const bands: { id: string | null; name: string }[] = [
    { id: null, name: "No lane" },
    ...lanes.map((lane) => ({ id: lane.id, name: lane.name })),
  ];

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3">
        <div className="w-28 shrink-0" aria-hidden />
        {statuses.map((status) => {
          // Column header shows the count/limit/points across every lane —
          // there's only one wip_limit per column (spec/data-model.md), not
          // one per lane cell.
          const columnStories = bands.flatMap((band) => containers[laneContainerKey(status.id, band.id)] ?? []);
          return <LaneColumnHeader key={status.id} status={status} stories={columnStories} projectId={projectId} />;
        })}
      </div>

      {bands.map((band) => (
        <div key={band.id ?? "none"} className="mt-3 flex gap-3">
          <div className="flex w-28 shrink-0 items-start pt-3">
            <span className="truncate text-sm font-medium text-muted-foreground">{band.name}</span>
          </div>
          {statuses.map((status) => (
            <LaneCell
              key={status.id}
              status={status}
              laneId={band.id}
              stories={containers[laneContainerKey(status.id, band.id)] ?? []}
              projectId={projectId}
              showComposer={band.id === null}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function LaneColumnHeader({
  status,
  stories,
  projectId,
}: {
  status: CustomStatus;
  stories: FreeStoryCardData[];
  projectId: string;
}) {
  return (
    <section className="w-72 shrink-0">
      <header className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <ColumnHeaderContent status={status} stories={stories} projectId={projectId} />
      </header>
    </section>
  );
}

function LaneCell({
  status,
  laneId,
  stories,
  projectId,
  showComposer,
}: {
  status: CustomStatus;
  laneId: string | null;
  stories: FreeStoryCardData[];
  projectId: string;
  showComposer: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: laneContainerKey(status.id, laneId) });

  // Same per-cell date grouping as the single-band board's is_done columns
  // (TASK-16.1) — decided per TASK-16.3 to group within each lane band
  // rather than across the whole column, since spec/screens.md doesn't
  // define how the two interact.
  const doneGroups = status.is_done
    ? groupDoneStories(
        stories.map((story) => ({
          story,
          completedDateKey: story.completed_at ? localDateKey(story.completed_at) : todayLocalDateKey(),
        })),
        todayLocalDateKey(),
      )
    : null;

  return (
    <section className="flex min-h-24 w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
      {showComposer && (
        <div className="px-3 pt-3 pb-2">
          <QuickAddComposer projectId={projectId} target={{ customStatusId: status.id }} />
        </div>
      )}
      <div className={`flex flex-1 flex-col overflow-y-auto px-3 pb-3 ${showComposer ? "" : "pt-3"}`}>
        <SortableContext
          items={doneGroups ? doneGroups.flatMap((g) => g.stories.map(({ story }) => story.id)) : stories.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
            {doneGroups
              ? doneGroups.map((group) => (
                  <Fragment key={group.dateKey}>
                    <li className="text-xs font-semibold text-muted-foreground">{group.label}</li>
                    {group.stories.map(({ story }) => (
                      <SortableFreeCard key={story.id} story={story} projectId={projectId} />
                    ))}
                  </Fragment>
                ))
              : stories.map((story) => <SortableFreeCard key={story.id} story={story} projectId={projectId} />)}
          </ul>
        </SortableContext>
      </div>
    </section>
  );
}

function SortableFreeCard({ story, projectId }: { story: FreeStoryCardData; projectId: string }) {
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

// TASK-16.2: "Configured from the column header menu" (spec/screens.md) —
// a small kebab menu next to the count/limit, not the Settings status
// editor. Soft limit only: this only ever writes wip_limit, never touches
// drag/drop validation.
export function WipLimitMenu({
  projectId,
  statusId,
  currentLimit,
}: {
  projectId: string;
  statusId: string;
  currentLimit: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentLimit != null ? String(currentLimit) : "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(nextValue: string) {
    setError(null);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("status_id", statusId);
    formData.set("wip_limit", nextValue);
    startTransition(async () => {
      try {
        await setStatusWipLimit(formData);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update WIP limit");
      }
    });
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValue(currentLimit != null ? String(currentLimit) : "");
          setError(null);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Column options"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 p-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(value);
          }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor={`wip-limit-${statusId}`} className="text-xs font-medium text-muted-foreground">
            WIP limit
          </label>
          <Input
            id={`wip-limit-${statusId}`}
            type="number"
            min={1}
            step={1}
            value={value}
            disabled={isPending}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="No limit"
            className="h-7 text-xs"
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-1.5">
            <Button type="submit" size="xs" variant="outline" disabled={isPending}>
              Save
            </Button>
            {currentLimit != null && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={isPending}
                onClick={() => {
                  setValue("");
                  submit("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
