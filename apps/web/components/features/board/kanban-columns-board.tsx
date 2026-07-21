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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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
import { createProjectState, renameProjectState } from "@/app/projects/[id]/settings/actions";
import { beforeAnchorId, findContainer, moveBetweenContainers, storyById, sumPoints } from "@/lib/utils/board";
import { reorderContainer } from "@/lib/utils/board-dnd";
import { useOptimisticBoardOrder } from "./use-optimistic-board-order";
import { columnForStory, evaluateDrop, lowestUnstartedStateId, toGateStates, type KanbanColumnId } from "@/lib/utils/kanban";
import { categoryRank, matchesStoryFilter, type StoryFilter } from "@/lib/utils/stories";
import { isImeComposing } from "@/lib/utils/keyboard";
import type { ProjectState } from "@/lib/types";
import type { StateCategory } from "@storylane/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { MutationErrorBanner } from "./mutation-error-banner";
import { DraftStoryCard, DraftStoryTrigger } from "./draft-story-card";
import { StoryCard } from "./story-card";
import { SortableItem } from "./sortable-item";
import { useInlineEdit } from "./use-inline-edit";
import type { BoardStory, IterationMeta } from "./kanban-board";

const CATEGORY_LABELS: Record<StateCategory, string> = {
  unstarted: "Unstarted",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as StateCategory[];

// Column header rename (doc-8 §2 option C hybrid) — reuses the retired
// free-mode ColumnNameEditor's exact interaction pattern (useInlineEdit is
// state-model-agnostic and survived that removal): click-to-edit, Enter/blur
// commits, Escape reverts.
function ColumnNameEditor({
  projectId,
  state,
  canEdit,
}: {
  projectId: string;
  state: ProjectState;
  canEdit: boolean;
}) {
  const { buttonRef, editor } = useInlineEdit({
    initialValue: state.name,
    fallbackError: "Failed to rename",
    shouldCommit: (value) => Boolean(value),
    async onCommit(trimmed) {
      const formData = new FormData();
      formData.set("project_id", projectId);
      formData.set("state_id", state.id);
      formData.set("name", trimmed);
      await renameProjectState(formData);
    },
  });

  if (!canEdit) {
    return <h2 className="truncate text-sm font-semibold">{state.name}</h2>;
  }

  if (!editor.editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={editor.startEditing}
        aria-label={`Rename column: ${editor.synced}`}
        className="truncate text-sm font-semibold hover:underline"
      >
        {editor.synced}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        autoFocus
        value={editor.value}
        onChange={(event) => editor.setValue(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) {
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void editor.commitAndClose("keyboard");
          } else if (event.key === "Escape") {
            event.preventDefault();
            editor.cancel("keyboard");
          }
        }}
        onBlur={() => void editor.commitAndClose("blur")}
        readOnly={editor.isSaving}
        aria-busy={editor.isSaving || undefined}
        className="h-6 w-32 rounded border border-border bg-transparent px-1 text-sm font-semibold focus:outline-none disabled:opacity-60"
      />
      {editor.error && <span className="text-xs text-destructive">{editor.error}</span>}
    </div>
  );
}

// Trailing "+ Add column" (doc-8 §2 option C hybrid), same board-level
// surface as the rename above. Unlike the retired AddColumnButton (a single
// name field with a hardcoded default color), a state also needs a
// category — a real form with an explicit submit rather than
// useInlineEdit's blur-commits (blurring between the name and category
// fields would otherwise misfire a premature commit).
function AddColumnButton({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StateCategory>("unstarted");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canEdit) {
    return null;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`flex w-40 shrink-0 items-start justify-center self-start rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground hover:text-foreground ${BOARD_COLUMN_HEIGHT_CLASS}`}
      >
        + Add column
      </button>
    );
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("project_id", projectId);
        formData.set("name", trimmed);
        formData.set("category", category);
        await createProjectState(formData);
        setName("");
        setEditing(false);
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
      className="flex w-40 shrink-0 flex-col gap-1.5 self-start rounded-lg border border-border p-2"
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) {
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setName("");
            setEditing(false);
          }
        }}
        placeholder="Column name"
        readOnly={isPending}
        className="h-7 text-sm"
      />
      <NativeSelect
        value={category}
        onChange={(event) => setCategory(event.target.value as StateCategory)}
        disabled={isPending}
        className="h-7 text-sm"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" size="xs" disabled={isPending || !name.trim()}>
        {isPending ? "Adding…" : "Add"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

type ColumnMeta = { label: string; icon: LucideIcon; iconClass: string; tintClass: string };

// Board columns only use a viewport-derived fixed height once the shared
// header has enough horizontal room not to wrap unpredictably. Exported for
// the List view's Icebox column so this sizing rule has one source of truth.
export const BOARD_COLUMN_HEIGHT_CLASS = "lg:h-[calc(100dvh-13rem)]";

// Icon/tint palettes, cycled by `categoryRank` (lib/utils/stories.ts) — the
// same index the state badges cycle their colors by, so a column and its
// stories' badges agree. This reproduces the classic template's original
// per-state look (Unstarted=muted circle, Started=blue play, Finished=purple
// check, Delivered=cyan package, Accepted=green check, Rejected=rose X) as
// the category-0/1/2 cycle, and degrades gracefully for a custom project
// with more states per category than a palette has entries.
const ICON_PALETTES: Record<ProjectState["category"], LucideIcon[]> = {
  unstarted: [Circle],
  in_progress: [CirclePlay, CircleCheck, PackageCheck],
  done: [CircleCheckBig],
  rejected: [CircleX],
};
const ICON_CLASS_PALETTES: Record<ProjectState["category"], string[]> = {
  unstarted: ["text-muted-foreground"],
  in_progress: ["text-blue-600 dark:text-blue-400", "text-purple-600 dark:text-purple-400", "text-cyan-600 dark:text-cyan-400"],
  done: ["text-green-600 dark:text-green-400"],
  rejected: ["text-rose-600 dark:text-rose-400"],
};
const TINT_PALETTES: Record<ProjectState["category"], string[]> = {
  unstarted: ["bg-muted/40"],
  in_progress: ["bg-blue-50/60 dark:bg-blue-950/20", "bg-purple-50/60 dark:bg-purple-950/20", "bg-cyan-50/60 dark:bg-cyan-950/20"],
  done: ["bg-green-50/60 dark:bg-green-950/20"],
  rejected: ["bg-rose-50/60 dark:bg-rose-950/20"],
};

function columnMeta(state: ProjectState, states: ReadonlyArray<ProjectState>): ColumnMeta {
  const rank = categoryRank(state.id, states);
  const atIndex = <T,>(palette: T[]) => palette[rank % palette.length];
  return {
    label: state.name,
    icon: atIndex(ICON_PALETTES[state.category]),
    iconClass: atIndex(ICON_CLASS_PALETTES[state.category]),
    tintClass: atIndex(TINT_PALETTES[state.category]),
  };
}

// The whole card is the drag handle (spec/screens.md "Story card UX": "no
// dedicated drag handle"). A plain click still opens the story normally —
// dnd-kit only intercepts the click once the pointer has actually moved past
// its activation threshold, so it doesn't fire for a stationary click.
function SortableStoryRow({ story, projectId }: { story: BoardStory; projectId: string }) {
  return (
    <SortableItem id={story.id}>
      <StoryCard story={story} projectId={projectId} />
    </SortableItem>
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
  projectId,
  state,
  states,
  stories,
  canManageStates,
  children,
  draftAdd,
}: {
  projectId: string;
  state: ProjectState;
  states: ReadonlyArray<ProjectState>;
  stories: BoardStory[];
  canManageStates: boolean;
  children: ReactNode;
  // Only the unstarted-category column gets the draft-story trigger
  // (TASK-82 AC#1: one "+" per panel — Kanban's is here, List's Current/
  // Backlog/Icebox panels get their own in BoardListView).
  draftAdd?: {
    pointScale: number[];
    epics: { id: string; name: string }[];
    members: { id: string; name: string; isAgent?: boolean }[];
    labels: { id: string; name: string }[];
  };
}) {
  const meta = columnMeta(state, states);
  const Icon = meta.icon;
  const points = sumPoints(stories);
  const [draftOpen, setDraftOpen] = useState(false);

  return (
    <section
      className={`flex w-72 shrink-0 flex-col rounded-lg border border-border ${BOARD_COLUMN_HEIGHT_CLASS} ${meta.tintClass}`}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Icon className={`size-4 shrink-0 ${meta.iconClass}`} aria-hidden />
        <ColumnNameEditor projectId={projectId} state={state} canEdit={canManageStates} />
        <span className="text-xs text-muted-foreground">{stories.length}</span>
        {points > 0 && <span className="text-xs text-muted-foreground">· {points} pts</span>}
        {draftAdd && (
          <DraftStoryTrigger label={`Add story to ${state.name}`} onClick={() => setDraftOpen(true)} />
        )}
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
        {draftAdd && draftOpen && (
          <DraftStoryCard
            projectId={projectId}
            target="unstarted"
            view="tracker"
            beforeItemId={stories[0]?.id ?? null}
            pointScale={draftAdd.pointScale}
            epics={draftAdd.epics}
            members={draftAdd.members}
            labels={draftAdd.labels}
            onClose={() => setDraftOpen(false)}
          />
        )}
        {children}
      </div>
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
  states,
  initialContainers,
  filter,
  canManageStates,
  pointScale,
  epics,
  members,
  labels,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  // The project's states, ordered by position — the physical column set.
  states: ProjectState[];
  // Keyed by KanbanColumnId: only the state-column buckets are read here —
  // this same object's backlog/icebox buckets are what `BoardListView` reads.
  // Unfiltered — see `visibleContainers` below for the rendered, filtered
  // view.
  initialContainers: Record<string, BoardStory[]>;
  filter: StoryFilter;
  // Gates the inline column rename / "+ Add column" controls (doc-8 §2
  // option C hybrid) — matches project_states' own RLS.
  canManageStates: boolean;
  // The draft story card's field options (TASK-82) — only the unstarted
  // column's trigger ever uses these.
  pointScale: number[];
  epics: { id: string; name: string }[];
  members: { id: string; name: string; isAgent?: boolean }[];
  labels: { id: string; name: string }[];
}) {
  // Optimistic order + realtime-safe reconcile + per-drag revert all live in
  // the shared hook (TASK-113). initialContainers is a reference-stable prop,
  // so it doubles as the reconcile change token.
  const { containers, setContainers, activeId, beginDrag, endDrag, revertToSnapshot, runDrop } =
    useOptimisticBoardOrder(initialContainers);
  const [dragError, setDragError] = useState<string | null>(null);

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
    // From `containers`, not the drop's visual container: a story's state/
    // iteration data (what columnForStory reads) is unchanged by an optimistic
    // reorder, so this stays the server-confirmed source column mid-drag.
    const story = storyById(containers, storyId);
    if (!story) {
      return false;
    }
    const from = columnForStory(story, currentIteration?.id ?? null);
    return evaluateDrop(story, from, targetContainer as KanbanColumnId, toGateStates(states)).ok;
  }

  function handleDragStart(event: DragStartEvent) {
    beginDrag(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) {
      return;
    }

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer) {
      return;
    }

    setContainers((prev) => moveBetweenContainers(prev, String(active.id), overContainer, String(over.id), isAllowedMove));
  }

  function handleDragEnd(event: DragEndEvent) {
    endDrag();
    const { active, over } = event;
    if (!over) {
      revertToSnapshot();
      return;
    }

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer || !isAllowedMove(String(active.id), overContainer)) {
      // Snap back the whole pre-drag board: nothing was sent to the server.
      revertToSnapshot();
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
    // Intent, not a full sequence: the neighbour the card now sits before (or
    // nothing = append). The server re-derives dense positions from current DB
    // order, so a stale client can't overwrite a concurrent drag (TASK-56).
    const beforeId = beforeAnchorId(reordered, String(active.id));
    if (beforeId) {
      formData.set("before_item_id", beforeId);
    }
    // runDrop re-derives the transition server-side from the story's *current*
    // state (see dropStory), so a stale client (e.g. another user already
    // accepted this story) is rejected there even though isAllowedMove passed;
    // on failure it reverts only this story, preserving a sibling drag still
    // in flight (TASK-113).
    runDrop(String(active.id), () => dropStory(formData), setDragError);
  }

  const sortedStates = [...states].sort((a, b) => a.position - b.position);
  const firstUnstartedId = lowestUnstartedStateId(toGateStates(states));
  // Based on the visible set — an empty rejected-category column that only
  // has content hidden by the active filter shouldn't clutter the board.
  // Non-rejected columns always render, even empty.
  const visibleColumns = sortedStates.filter(
    (state) => state.category !== "rejected" || (visibleContainers[state.id] ?? []).length > 0,
  );
  const activeStory = activeId ? storyById(containers, activeId) : undefined;

  return (
    <DndContext
      id="kanban-columns-board"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        // A cancelled drag (Esc / dropped nowhere) already floated the card
        // via onDragOver — restore the pre-drag board, not just clear activeId.
        endDrag();
        revertToSnapshot();
      }}
    >
      {dragError && (
        <div className="sticky top-0 z-20">
          <MutationErrorBanner message={dragError} onDismiss={() => setDragError(null)} />
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {visibleColumns.map((state) => (
          <KanbanColumn
            key={state.id}
            projectId={projectId}
            state={state}
            states={states}
            stories={visibleContainers[state.id] ?? []}
            canManageStates={canManageStates}
            draftAdd={
              state.id === firstUnstartedId ? { pointScale, epics, members, labels } : undefined
            }
          >
            <DroppableStoryList
              containerId={state.id}
              stories={visibleContainers[state.id] ?? []}
              projectId={projectId}
            />
          </KanbanColumn>
        ))}
        <AddColumnButton projectId={projectId} canEdit={canManageStates} />
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
