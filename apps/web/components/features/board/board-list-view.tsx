"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
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
import { Plus, Snowflake, X } from "lucide-react";
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
import { buildBacklogRows, type BacklogDivider, type BacklogRowItem } from "@/lib/utils/iterations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryListRow } from "./story-list-row";
import type { BoardStory, IterationMeta } from "./kanban-board";

// Internal drag item for the List view's zones. Current/Icebox only ever
// hold `kind: "story"`; only Backlog can also hold `kind: "divider"` (Task
// 15 follow-up: freeform planning dividers, spec/screens.md "Board layout:
// List view"). A shared `id` at the top level (rather than nested under
// `story`/`divider`) lets the generic `findContainer`/`storyById` helpers
// (from lib/utils/board, shared with the Kanban view) work uniformly.
type ListItem = { kind: "story"; id: string; story: BoardStory } | { kind: "divider"; id: string; label: string };

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
      item.kind === "story" ? wrapStory(item.story) : { kind: "divider", id: item.divider.id, label: item.divider.label },
    ),
  };
}

// The whole row is the drag handle, same convention as the Kanban view's
// cards — plain clicks still open the side peek since dnd-kit only takes
// over past the pointer's activation distance.
function SortableListRow({ item, projectId }: { item: ListItem; projectId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const className = `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-60" : ""}`;

  if (item.kind === "divider") {
    return (
      <li ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
        <DividerRow projectId={projectId} divider={{ id: item.id, label: item.label }} />
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      <StoryListRow story={item.story} projectId={projectId} />
    </li>
  );
}

// A freeform planning divider row: dashed border and a distinct icon set it
// apart from the automatic, non-deletable "Iteration #N" marker rows.
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

// Non-draggable, decorative divider for the automatic velocity-based
// "Iteration #N" markers (see spec/velocity.md "Marker computation") —
// distinct from `DividerRow`'s user-created, deletable planning dividers.
function IterationMarkerRow({ number, points }: { number: number; points: number }) {
  return (
    <li aria-hidden className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span>
        Iteration #{number} · {points} pts
      </span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

// Inline "+ Add divider" composer (same interaction convention as
// `QuickAddComposer`): a dashed button that turns into a label input in
// place. Enter creates the divider at the end of the backlog — the PO then
// drags it to the desired spot via the same reorder as any other item.
function AddDividerComposer({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("label", trimmed);

    setLabel("");
    startTransition(() => {
      void createBacklogDivider(formData);
    });
    inputRef.current?.focus();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="size-3.5" aria-hidden />
        Add divider
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1">
      <Input
        ref={inputRef}
        autoFocus
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setLabel("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!label.trim()) {
            setOpen(false);
          }
        }}
        placeholder="Divider label (e.g. “Phase 2”) — Enter to add"
        aria-label="New divider label"
        className="h-7 max-w-64 bg-card text-xs"
      />
    </form>
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
      <header className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        {title}
        <span className="h-px flex-1 bg-border" />
      </header>
      {composer && <div>{composer}</div>}
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

// Backlog section: like `ListSection`, but rows are built via
// `buildBacklogRows` so the automatic "Iteration #N" markers and the
// freeform planning dividers both interleave with the stories in one flat
// sortable list — a drag across any of them is an ordinary reorder.
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
    item.kind === "story"
      ? { kind: "story", story: item.story }
      : { kind: "divider", divider: { id: item.id, label: item.label } },
  );
  const rows = buildBacklogRows(rowItems, velocity, startingIterationNumber);
  const itemById = new Map(items.map((item) => [item.id, item]));

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Backlog</span>
        <AddDividerComposer projectId={projectId} />
        <span className="h-px flex-1 bg-border" />
      </header>
      {composer && <div>{composer}</div>}
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-col gap-1.5">
          {rows.map((row, index) => {
            if (row.kind === "iteration-marker") {
              return <IterationMarkerRow key={`marker-${index}`} number={row.number} points={row.points} />;
            }
            const id = row.kind === "story" ? row.story.id : row.divider.id;
            const item = itemById.get(id);
            return item ? <SortableListRow key={id} item={item} projectId={projectId} /> : null;
          })}
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
      </header>
      <div className="px-3 pb-2">
        <QuickAddComposer projectId={projectId} target="icebox" />
      </div>
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
  // Backlog stories and freeform planning dividers, pre-merged and ordered
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
            composer={<QuickAddComposer projectId={projectId} target="unstarted" />}
          />

          <BacklogSection
            items={backlogItems}
            velocity={velocity}
            startingIterationNumber={nextVirtualIterationNumber}
            projectId={projectId}
            composer={<QuickAddComposer projectId={projectId} target="backlog" />}
          />
        </div>

        {showIcebox && <IceboxColumn items={iceboxItems} projectId={projectId} />}
      </div>

      <DragOverlay>
        {activeItem && (
          <div className="max-w-3xl rotate-1 cursor-grabbing">
            {activeItem.kind === "divider" ? (
              <DividerRow projectId={projectId} divider={{ id: activeItem.id, label: activeItem.label }} />
            ) : (
              <StoryListRow story={activeItem.story} projectId={projectId} />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
