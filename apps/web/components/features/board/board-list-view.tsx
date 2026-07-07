"use client";

import { Fragment, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
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
import { Snowflake, X } from "lucide-react";
import { createBacklogDivider, deleteBacklogDivider, dropStoryInList } from "@/app/projects/[id]/board/actions";
import { findContainer, storyById, sumPoints } from "@/lib/utils/board";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  STATE_COLUMNS,
  evaluateListDrop,
  zoneForStory,
  type ListZoneId,
} from "@/lib/utils/kanban";
import { buildBacklogRows, type BacklogDivider, type BacklogRow, type BacklogRowItem } from "@/lib/utils/iterations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryListRow } from "./story-list-row";
import type { BoardStory, IterationMeta } from "./kanban-board";

// Internal drag item for the List view's zones. Current/Icebox only ever
// hold `kind: "story"`; only Backlog can also hold `kind: "divider"` (Task
// 15 follow-up: freeform planning rows, spec/screens.md "Board layout: List
// view"). A shared `id` at the top level (rather than nested under
// `story`/`divider`) lets the generic `findContainer`/`storyById` helpers
// (from lib/utils/board, shared with the Kanban view) work uniformly.
type ListItem =
  | { kind: "story"; id: string; story: BoardStory }
  | { kind: "divider"; id: string; divider: BacklogDivider };

function wrapStory(story: BoardStory): ListItem {
  return { kind: "story", id: story.id, story };
}

function toListItemContainers(
  source: Record<string, BoardStory[]>,
  backlogItems: ReadonlyArray<BacklogRowItem<BoardStory>>,
): Record<string, ListItem[]> {
  return {
    [ICEBOX_COLUMN_ID]: (source[ICEBOX_COLUMN_ID] ?? []).map(wrapStory),
    current: STATE_COLUMNS.flatMap((column) => source[column] ?? []).map(wrapStory),
    [BACKLOG_COLUMN_ID]: backlogItems.map((item) =>
      item.kind === "story" ? wrapStory(item.story) : { kind: "divider", id: item.divider.id, divider: item.divider },
    ),
  };
}

// The whole row is the drag handle, same convention as the Kanban view's
// cards — plain clicks still open the side peek since dnd-kit only takes
// over past the pointer's activation distance. Used by the Current/Icebox
// sections, which only ever hold stories — the Backlog section uses
// `SortableBacklogRow` instead since it also renders notes/iteration breaks.
function SortableListRow({ item, projectId }: { item: ListItem; projectId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const className = `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-60" : ""}`;

  return (
    <li ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {item.kind === "divider" ? (
        <DividerRow projectId={projectId} divider={item.divider} />
      ) : (
        <StoryListRow story={item.story} projectId={projectId} />
      )}
    </li>
  );
}

// A freeform planning note: dashed border, muted label, delete button —
// distinct from the automatic, non-deletable "Iteration #N" marker.
function DividerRow({ projectId, divider }: { projectId: string; divider: BacklogDivider }) {
  const [, startTransition] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("divider_id", divider.id);
    startTransition(() => {
      void deleteBacklogDivider(formData);
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-1.5">
      <span className="flex-1 truncate text-sm font-medium text-muted-foreground">{divider.label}</span>
      <Button type="button" variant="ghost" size="icon-xs" onClick={handleDelete} aria-label={`Remove "${divider.label}"`}>
        <X />
      </Button>
    </div>
  );
}

// The "Iteration #N · X pts" line content, shared by the automatic
// (capacity-triggered, no `divider`) and manual (`iteration_break` row,
// deletable) markers — see lib/utils/iterations.ts "buildBacklogRows".
function IterationMarkerContent({
  number,
  points,
  projectId,
  divider,
}: {
  number: number;
  points: number;
  projectId?: string;
  divider?: BacklogDivider;
}) {
  const [, startTransition] = useTransition();

  function handleDelete() {
    if (!divider || !projectId) {
      return;
    }
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("divider_id", divider.id);
    startTransition(() => {
      void deleteBacklogDivider(formData);
    });
  }

  return (
    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span>
        Iteration #{number} · {points} pts
      </span>
      {divider && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleDelete}
          aria-label={`Remove manual iteration break before #${number}`}
        >
          <X />
        </Button>
      )}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// Non-draggable row for an automatic, capacity-triggered marker — there's no
// backlog_dividers row behind it, so nothing to drag or delete.
function IterationMarkerRow({ number, points }: { number: number; points: number }) {
  return (
    <li aria-hidden>
      <IterationMarkerContent number={number} points={points} />
    </li>
  );
}

// A draggable Backlog row: a story, a note, or a manually-placed iteration
// break (which — unlike an automatic marker — has a real `backlog_dividers`
// row behind it, so it can be reordered and deleted like any other item).
// Callers only render this for rows that have a real id to drag (never for
// an automatic marker, whose `divider` is undefined — see `BacklogSection`).
function SortableBacklogRow({ row, projectId }: { row: BacklogRow<BoardStory>; projectId: string }) {
  const dragId = row.kind === "story" ? row.story.id : row.divider!.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dragId });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const className = `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-60" : ""}`;

  let content: ReactNode;
  if (row.kind === "story") {
    content = <StoryListRow story={row.story} projectId={projectId} />;
  } else if (row.kind === "note") {
    content = <DividerRow projectId={projectId} divider={row.divider} />;
  } else {
    content = (
      <IterationMarkerContent number={row.number} points={row.points} projectId={projectId} divider={row.divider!} />
    );
  }

  return (
    <li ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {content}
    </li>
  );
}

// Hover-revealed "insert a line here" affordance between two adjacent
// Backlog rows (Task 15 follow-up — owner: appending then dragging wasn't
// discoverable enough). `beforeItemId` is a `"story:<id>"` / `"divider:<id>"`
// pair identifying the exact spot server-side (see board/actions.ts
// "createBacklogDivider"); `null` means "at the end".
function InsertBetweenRows({ projectId, beforeItemId }: { projectId: string; beforeItemId: string | null }) {
  const [addingNote, setAddingNote] = useState(false);
  const [label, setLabel] = useState("");
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("label", trimmed);
    formData.set("kind", "note");
    if (beforeItemId) {
      formData.set("before_item_id", beforeItemId);
    }
    setLabel("");
    setAddingNote(false);
    startTransition(() => {
      void createBacklogDivider(formData);
    });
  }

  function insertIterationBreak() {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("kind", "iteration_break");
    if (beforeItemId) {
      formData.set("before_item_id", beforeItemId);
    }
    startTransition(() => {
      void createBacklogDivider(formData);
    });
  }

  if (addingNote) {
    return (
      <li className="py-0.5">
        <form onSubmit={submitNote}>
          <Input
            ref={inputRef}
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLabel("");
                setAddingNote(false);
              }
            }}
            onBlur={() => {
              if (!label.trim()) {
                setAddingNote(false);
              }
            }}
            placeholder="Divider label — Enter to add"
            aria-label="New divider label"
            className="h-7 bg-card text-xs"
          />
        </form>
      </li>
    );
  }

  return (
    <li className="group/insert relative -my-1 h-2 shrink-0">
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/insert:opacity-100">
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={() => setAddingNote(true)}
          className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          + Note
        </button>
        <button
          type="button"
          onClick={insertIterationBreak}
          className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          + Iteration break
        </button>
        <span className="h-px flex-1 bg-border" />
      </div>
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
  items,
  projectId,
  composer,
}: {
  zoneId: string;
  title: ReactNode;
  items: ListItem[];
  projectId: string;
  composer?: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: zoneId });

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
        {title}
        {composer}
        <span className="h-px flex-1 bg-border" />
      </header>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-col gap-1.5">
          {items.map((item) => (
            <SortableListRow key={item.id} item={item} projectId={projectId} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

// A stable React key for a backlog row — the underlying story/divider id
// for anything real, or a synthetic key for an automatic marker (which has
// no id of its own).
function rowKey(row: BacklogRow<BoardStory>, index: number): string {
  if (row.kind === "story") {
    return row.story.id;
  }
  if (row.kind === "note" || row.divider) {
    return row.divider!.id;
  }
  return `auto-marker-${index}`;
}

// Finds the id (`"story:<id>"` / `"divider:<id>"`) of the next *real* row at
// or after `fromIndex` — skipping over automatic markers, which aren't
// stored rows and so have nothing to anchor an insertion to. `null` means
// "insert at the end" (no real row follows).
function nextRealRowId(rows: BacklogRow<BoardStory>[], fromIndex: number): string | null {
  for (let i = fromIndex; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "story") {
      return `story:${row.story.id}`;
    }
    if (row.kind === "note" || (row.kind === "iteration-marker" && row.divider)) {
      return `divider:${row.divider!.id}`;
    }
  }
  return null;
}

// Backlog section: rows come from `buildBacklogRows`, which interleaves the
// automatic velocity-based markers, freeform notes, and manual iteration
// breaks with the stories in one flat sortable list — a drag across any of
// them is an ordinary reorder. A hover-revealed insert affordance sits
// between every pair of rows so a note or break can be placed at an exact
// spot instead of appended-then-dragged.
function BacklogSection({
  items,
  velocity,
  startingIterationNumber,
  projectId,
  composer,
}: {
  items: ListItem[];
  velocity: number;
  startingIterationNumber: number;
  projectId: string;
  composer?: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: BACKLOG_COLUMN_ID });

  const rowItems: BacklogRowItem<BoardStory>[] = items.map((item) =>
    item.kind === "story" ? { kind: "story", story: item.story } : { kind: "divider", divider: item.divider },
  );
  const rows = buildBacklogRows(rowItems, velocity, startingIterationNumber);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Backlog</span>
        {composer}
        <span className="h-px flex-1 bg-border" />
      </header>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-col gap-1.5">
          <InsertBetweenRows projectId={projectId} beforeItemId={nextRealRowId(rows, 0)} />
          {rows.map((row, index) => (
            <Fragment key={rowKey(row, index)}>
              {row.kind === "iteration-marker" && !row.divider ? (
                <IterationMarkerRow number={row.number} points={row.points} />
              ) : (
                <SortableBacklogRow row={row} projectId={projectId} />
              )}
              <InsertBetweenRows projectId={projectId} beforeItemId={nextRealRowId(rows, index + 1)} />
            </Fragment>
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

// Icebox rendered as its own narrow side column (Task 15 follow-up) rather
// than an inline stacked section — it's a pre-triage parking lot, not part
// of the priority order, so keeping it out of the main list lets the PO
// focus purely on Current/Backlog priority (see spec/screens.md "Board
// layout: List view").
function IceboxColumn({ items, projectId }: { items: ListItem[]; projectId: string }) {
  const { setNodeRef } = useDroppable({ id: ICEBOX_COLUMN_ID });

  return (
    <section className="flex h-[calc(100dvh-13rem)] w-72 shrink-0 flex-col rounded-lg border border-border bg-sky-50/50 dark:bg-sky-950/20">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Snowflake className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
        <h2 className="text-sm font-semibold">Icebox</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
        <span className="ml-auto">
          <QuickAddComposer projectId={projectId} target="icebox" compact />
        </span>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-1.5">
            {items.map((item) => (
              <SortableListRow key={item.id} item={item} projectId={projectId} />
            ))}
          </ul>
        </SortableContext>
      </div>
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
  initialBacklogItems,
  velocity,
  nextVirtualIterationNumber,
  showIcebox,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  initialContainers: Record<string, BoardStory[]>;
  // Backlog stories and freeform planning rows, pre-merged and ordered
  // server-side (see board/page.tsx) since only the server has both tables'
  // raw `position` values needed to interleave them correctly.
  initialBacklogItems: BacklogRowItem<BoardStory>[];
  velocity: number;
  nextVirtualIterationNumber: number;
  showIcebox: boolean;
}) {
  const [containers, setContainers] = useState(() => toListItemContainers(initialContainers, initialBacklogItems));
  const [synced, setSynced] = useState(initialContainers);
  const [syncedBacklogItems, setSyncedBacklogItems] = useState(initialBacklogItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (synced !== initialContainers || syncedBacklogItems !== initialBacklogItems) {
    setSynced(initialContainers);
    setSyncedBacklogItems(initialBacklogItems);
    setContainers(toListItemContainers(initialContainers, initialBacklogItems));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Derived from the item's own data (via the server-confirmed `synced`
  // snapshot), not the visual zone. A divider can only ever reorder within
  // the Backlog zone — it never has a story's state/iteration to validate.
  function isAllowedMove(itemId: string, targetZone: string): boolean {
    const item = storyById(containers, itemId);
    if (!item) {
      return false;
    }
    if (item.kind === "divider") {
      return targetZone === BACKLOG_COLUMN_ID;
    }
    const story = storyById(synced, itemId);
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
      const activeIndex = activeItems.findIndex((item) => item.id === active.id);
      const overIndex = overItems.findIndex((item) => item.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;
      const moved = activeItems[activeIndex];
      if (!moved) {
        return prev;
      }

      return {
        ...prev,
        [activeContainer]: activeItems.filter((item) => item.id !== active.id),
        [overContainer]: [...overItems.slice(0, insertAt), moved, ...overItems.slice(insertAt)],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    const fallback = () => setContainers(toListItemContainers(synced, syncedBacklogItems));

    if (!over) {
      fallback();
      return;
    }

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer || !isAllowedMove(String(active.id), overContainer)) {
      fallback();
      return;
    }

    const items = containers[overContainer];
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    const reordered =
      oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex ? arrayMove(items, oldIndex, newIndex) : items;

    setContainers((prev) => ({ ...prev, [overContainer]: reordered }));

    const activeItem = storyById(containers, String(active.id));
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("item_kind", activeItem?.kind ?? "story");
    formData.set("item_id", String(active.id));
    formData.set("target_zone", overContainer);
    reordered.forEach((item) => formData.append("ordered_ids", `${item.kind}:${item.id}`));
    startTransition(() => {
      void dropStoryInList(formData);
    });
  }

  const iceboxItems = containers[ICEBOX_COLUMN_ID] ?? [];
  const currentItems = containers.current ?? [];
  const backlogItems = containers[BACKLOG_COLUMN_ID] ?? [];
  const currentStoryItems = currentItems.filter((item): item is Extract<ListItem, { kind: "story" }> => item.kind === "story");
  const activeItem = activeId ? storyById(containers, activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4">
        <div className="flex max-w-3xl flex-1 flex-col gap-6">
          <ListSection
            zoneId="current"
            title={
              <span className="font-semibold text-foreground">
                {currentIteration ? `Iteration #${currentIteration.number} · current` : "Current iteration"} ·{" "}
                {sumPoints(currentStoryItems.map((item) => item.story))} pts
              </span>
            }
            items={currentItems}
            projectId={projectId}
            composer={<QuickAddComposer projectId={projectId} target="unstarted" compact />}
          />

          <BacklogSection
            items={backlogItems}
            velocity={velocity}
            startingIterationNumber={nextVirtualIterationNumber}
            projectId={projectId}
            composer={<QuickAddComposer projectId={projectId} target="backlog" compact />}
          />
        </div>

        {showIcebox && <IceboxColumn items={iceboxItems} projectId={projectId} />}
      </div>

      <DragOverlay>
        {activeItem && (
          <div className="max-w-3xl rotate-1 cursor-grabbing">
            {activeItem.kind === "divider" ? (
              activeItem.divider.kind === "note" ? (
                <DividerRow projectId={projectId} divider={activeItem.divider} />
              ) : (
                <IterationMarkerContent number={0} points={0} />
              )
            ) : (
              <StoryListRow story={activeItem.story} projectId={projectId} />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
