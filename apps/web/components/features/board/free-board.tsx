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
import {
  createCustomStatus,
  deleteCustomStatus,
  setStatusWipLimit,
  updateCustomStatus,
} from "@/app/projects/[id]/settings/actions";
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

// An optional horizontal lane (spec/screens.md "Swimlanes").
export type Swimlane = {
  id: string;
  name: string;
  position: number;
};

// is_done columns show when each card was completed, grouped under date
// headers — completed_at is DB-trigger-maintained (see
// 20260709000005_free_mode_completed_at.sql), set whenever a story moves
// into an is_done column, cleared when it moves out. Also carries
// swimlane_id so a lane-less board can be told apart from a card
// explicitly sitting in the No lane band.
type FreeStoryCardData = StoryCardData & { completed_at: string | null; swimlane_id: string | null };

function todayLocalDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Free-mode board (spec/screens.md): a pure Trello-style kanban.
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
  canEdit = false,
  canDelete = false,
}: {
  projectId: string;
  statuses: CustomStatus[];
  // When non-empty, `initialContainers` is keyed by
  // `laneContainerKey(statusId, laneId)` instead of a bare status id.
  lanes: Swimlane[];
  initialContainers: Record<string, FreeStoryCardData[]>;
  toolbar?: ReactNode;
  // Same gating as Settings' status-manager.tsx (project_role RLS on
  // custom_statuses): member+ can add/rename/recolor, owner-only can delete.
  canEdit?: boolean;
  canDelete?: boolean;
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
    // Awaited and caught so a failed/RLS-filtered write reverts the
    // optimistic move and surfaces an error instead of leaving the card in
    // a column the server never actually applied.
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
        <div className="flex items-start gap-3">
          <p className="flex-1 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {canEdit ? "No board columns yet." : "No board columns yet. Ask a project member to add one."}
          </p>
          <AddColumnButton projectId={projectId} canEdit={canEdit} />
        </div>
      ) : hasLanes ? (
        <FreeBoardLanes
          statuses={statuses}
          lanes={lanes}
          containers={containers}
          projectId={projectId}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {statuses.map((status) => (
            <FreeColumn
              key={status.id}
              status={status}
              stories={containers[status.id] ?? []}
              projectId={projectId}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
          <AddColumnButton projectId={projectId} canEdit={canEdit} />
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
// column-header row, where it's rendered once for the whole column and
// `stories` is the sum across every lane band.
function ColumnHeaderContent({
  status,
  stories,
  projectId,
  canEdit,
  canDelete,
}: {
  status: CustomStatus;
  stories: FreeStoryCardData[];
  projectId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const points = sumPoints(stories);
  // A soft WIP limit — over it is purely a warning color, drops are never
  // blocked (spec/screens.md "Free mode board").
  const overWipLimit = isOverWipLimit(stories.length, status.wip_limit);

  return (
    <>
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} aria-hidden />
      {canEdit ? (
        <ColumnNameEditor projectId={projectId} status={status} />
      ) : (
        <h2 className="truncate text-sm font-semibold">{status.name}</h2>
      )}
      <span className={`text-xs ${overWipLimit ? "font-semibold text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
        {status.wip_limit != null ? `${stories.length} / ${status.wip_limit}` : stories.length}
      </span>
      {points > 0 && <span className="text-xs text-muted-foreground">· {points} pts</span>}
      <ColumnMenu projectId={projectId} status={status} canEdit={canEdit} canDelete={canDelete} />
    </>
  );
}

// Click-to-edit column name (spec/ux-principles.md #5: saved values render
// as values, not editors). Commits the full row since updateCustomStatus
// writes name/color/is_done together — color and is_done are resubmitted
// unchanged so a rename never clobbers them.
function ColumnNameEditor({ projectId, status }: { projectId: string; status: CustomStatus }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(status.name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(status.name);
          setError(null);
          setEditing(true);
        }}
        className="h-6 min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
      >
        {status.name}
      </button>
    );
  }

  function submit() {
    if (isPending) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === status.name) {
      setEditing(false);
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("status_id", status.id);
    formData.set("name", trimmed);
    formData.set("color", status.color);
    if (status.is_done) {
      formData.set("is_done", "on");
    }
    startTransition(async () => {
      try {
        await updateCustomStatus(formData);
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename column");
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <input
        autoFocus
        value={value}
        aria-label={`Rename ${status.name}`}
        // readOnly, not disabled — a disabled input can drop focus mid-blur
        // and re-fire the commit (same defect class noted on IterationGoalBar).
        readOnly={isPending}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            setValue(status.name);
            setError(null);
            setEditing(false);
          }
        }}
        className="h-6 w-full min-w-0 rounded border border-input bg-background px-1 text-sm font-semibold"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// "+ Add column" (spec/ux-principles.md #4: the create destination is
// visible at the point of action) — appended at the end of the row via
// createCustomStatus; default color matches Settings' status-manager.tsx.
function AddColumnButton({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canEdit) {
    return null;
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-9 w-40 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      >
        + Add column
      </button>
    );
  }

  function submit() {
    if (isPending) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setAdding(false);
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("name", trimmed);
    formData.set("color", "#6b7280");
    startTransition(async () => {
      try {
        await createCustomStatus(formData);
        setName("");
        setAdding(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add column");
      }
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex w-40 shrink-0 flex-col gap-1.5 self-start"
    >
      <Input
        autoFocus
        value={name}
        placeholder="Column name"
        readOnly={isPending}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setName("");
            setError(null);
            setAdding(false);
          }
        }}
        className="h-9 text-sm"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function FreeColumn({
  status,
  stories,
  projectId,
  canEdit,
  canDelete,
}: {
  status: CustomStatus;
  stories: FreeStoryCardData[];
  projectId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: status.id });

  // is_done columns group their cards under date headers
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
        <ColumnHeaderContent status={status} stories={stories} projectId={projectId} canEdit={canEdit} canDelete={canDelete} />
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

// The lanes layout (spec/screens.md "Swimlanes") — a column
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
  canEdit,
  canDelete,
}: {
  statuses: CustomStatus[];
  lanes: Swimlane[];
  containers: Record<string, FreeStoryCardData[]>;
  projectId: string;
  canEdit: boolean;
  canDelete: boolean;
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
          return (
            <LaneColumnHeader
              key={status.id}
              status={status}
              stories={columnStories}
              projectId={projectId}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          );
        })}
        <AddColumnButton projectId={projectId} canEdit={canEdit} />
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
  canEdit,
  canDelete,
}: {
  status: CustomStatus;
  stories: FreeStoryCardData[];
  projectId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <section className="w-72 shrink-0">
      <header className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <ColumnHeaderContent status={status} stories={stories} projectId={projectId} canEdit={canEdit} canDelete={canDelete} />
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

  // Same per-cell date grouping as the single-band board's is_done
  // columns — grouped within each lane band rather than across the whole
  // column, since spec/screens.md doesn't define how the two interact.
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

// The column header's kebab menu (spec/screens.md "Configured from the
// column header menu"), distinct from the Settings status editor
// (status-manager.tsx) but writing through the same server actions so
// there's exactly one place each mutation happens. WIP limit is a pure
// board affordance (never touches drag/drop validation); color/done/delete
// mirror the Settings form. Not rendered at all for viewers (canEdit false).
export function ColumnMenu({
  projectId,
  status,
  canEdit,
  canDelete,
}: {
  projectId: string;
  status: CustomStatus;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);

  const [limitValue, setLimitValue] = useState(status.wip_limit != null ? String(status.wip_limit) : "");
  const [limitError, setLimitError] = useState<string | null>(null);
  const [isLimitPending, startLimitTransition] = useTransition();

  const [color, setColor] = useState(status.color);
  const [isDone, setIsDone] = useState(status.is_done);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSettingsPending, startSettingsTransition] = useTransition();

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();

  if (!canEdit) {
    return null;
  }

  function submitLimit(nextValue: string) {
    setLimitError(null);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("status_id", status.id);
    formData.set("wip_limit", nextValue);
    startLimitTransition(async () => {
      try {
        await setStatusWipLimit(formData);
        setOpen(false);
      } catch (err) {
        setLimitError(err instanceof Error ? err.message : "Failed to update WIP limit");
      }
    });
  }

  function submitSettings() {
    setSettingsError(null);
    // Full-row write — name is resubmitted unchanged so this never clobbers
    // a rename made through ColumnNameEditor.
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("status_id", status.id);
    formData.set("name", status.name);
    formData.set("color", color);
    if (isDone) {
      formData.set("is_done", "on");
    }
    startSettingsTransition(async () => {
      try {
        await updateCustomStatus(formData);
        setOpen(false);
      } catch (err) {
        setSettingsError(err instanceof Error ? err.message : "Failed to update column");
      }
    });
  }

  function submitDelete() {
    setDeleteError(null);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("status_id", status.id);
    startDeleteTransition(async () => {
      try {
        await deleteCustomStatus(formData);
        setOpen(false);
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to delete column");
      }
    });
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLimitValue(status.wip_limit != null ? String(status.wip_limit) : "");
          setColor(status.color);
          setIsDone(status.is_done);
          setLimitError(null);
          setSettingsError(null);
          setDeleteError(null);
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
      <DropdownMenuContent align="start" className="w-56 p-2">
        <div className="flex flex-col gap-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitSettings();
            }}
            className="flex flex-col gap-1.5"
          >
            <span className="text-xs font-medium text-muted-foreground">Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Column color"
                value={color}
                disabled={isSettingsPending}
                onChange={(event) => setColor(event.target.value)}
                className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              />
              <label className="flex items-center gap-1.5 text-sm" title="Counts as done in reports">
                <input
                  type="checkbox"
                  checked={isDone}
                  disabled={isSettingsPending}
                  onChange={(event) => setIsDone(event.target.checked)}
                />
                Done column
              </label>
            </div>
            {settingsError && (
              <p role="alert" className="text-xs text-destructive">
                {settingsError}
              </p>
            )}
            <Button type="submit" size="xs" variant="outline" disabled={isSettingsPending}>
              Save column
            </Button>
          </form>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitLimit(limitValue);
            }}
            className="flex flex-col gap-1.5"
          >
            <label htmlFor={`wip-limit-${status.id}`} className="text-xs font-medium text-muted-foreground">
              WIP limit
            </label>
            <Input
              id={`wip-limit-${status.id}`}
              type="number"
              min={1}
              step={1}
              value={limitValue}
              disabled={isLimitPending}
              onChange={(event) => {
                setLimitValue(event.target.value);
                setLimitError(null);
              }}
              placeholder="No limit"
              className="h-7 text-xs"
            />
            {limitError && (
              <p role="alert" className="text-xs text-destructive">
                {limitError}
              </p>
            )}
            <div className="flex gap-1.5">
              <Button type="submit" size="xs" variant="outline" disabled={isLimitPending}>
                Save limit
              </Button>
              {status.wip_limit != null && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={isLimitPending}
                  onClick={() => {
                    setLimitValue("");
                    submitLimit("");
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </form>

          {canDelete && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-2">
              {deleteError && (
                <p role="alert" className="text-xs text-destructive">
                  {deleteError}
                </p>
              )}
              <Button type="button" size="xs" variant="destructive" disabled={isDeletePending} onClick={submitDelete}>
                Delete column
              </Button>
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
