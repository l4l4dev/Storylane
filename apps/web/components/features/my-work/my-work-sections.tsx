"use client";

import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays } from "@storylane/core";
import {
  carryOverToday,
  dismissCarryOver,
  renameMyWorkColumn,
  renameMyWorkFixedColumn,
  reorderMyWorkColumn,
  reorderMyWorkToday,
  saveMyWorkColumnOrder,
  setMyWorkColumn,
} from "@/app/my-work/actions";
import { findContainer, moveBetweenContainers, storyById } from "@/lib/utils/board";
import { reorderContainer, reorderIds } from "@/lib/utils/board-dnd";
import { formatDate, localTodayKey } from "@/lib/utils/format";
import {
  canDropOnDone,
  classifyMyWork,
  DEFAULT_COLUMN_NAMES,
  groupDoneByDate,
  isManualOrderReorder,
  regroupByProject,
  resolveDragEndTarget,
  toDragContainers,
  type DoneEntry,
  type MyWorkColumnId,
  type MyWorkColumnNames,
  type MyWorkDragItem,
  type MyWorkFreeColumn,
  type MyWorkProject,
  type MyWorkStory,
} from "@/lib/utils/my-work";
import { BOARD_COLUMN_HEIGHT_CLASS } from "@/components/features/board/kanban-columns-board";
import { MutationErrorBanner } from "@/components/features/board/mutation-error-banner";
import { SortableItem } from "@/components/features/board/sortable-item";
import { useOptimisticBoardOrder } from "@/components/features/board/use-optimistic-board-order";
import { AddColumnTile, ColumnNameField, DeleteColumnButton } from "./my-work-column-manager";
import { MyWorkRow, type MyWorkRowData } from "./my-work-row";

// The viewer's local wall date, read the SSR-safe way: the server snapshot is
// the caller's UTC today (hydration-stable), then React swaps to the client's
// local date after hydration — no setState-in-effect, no hydration mismatch.
// A noop subscribe is fine: the date is read once per mount (a midnight
// rollover is picked up on the next refresh).
const NOOP_SUBSCRIBE = () => () => {};

function doneDateLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === addDays(todayKey, -1)) return "Yesterday";
  return formatDate(dateKey);
}

// One My Work Kanban column shell (doc-14, TASK-132) — mirrors
// kanban-columns-board.tsx's KanbanColumn (tinted header, independently
// scrollable body) but without its state-management chrome. TASK-148: the
// whole column is ALSO a horizontal sortable item (dragging it reorders
// Todo/Today/Done/free columns alike) — but only the small grip handle in
// the header carries the drag listeners, never the header/section itself,
// so grabbing a card inside a column never moves the column and vice versa
// (the same shared DndContext disambiguates the two via each draggable's
// `data.type`, set here to "column" and on SortableItem to "card").
// The column-level sortable id is namespaced ("col:xxx") because the SAME
// bare id ("today", a free column's uuid, ...) is already registered as a
// card-container droppable by FlatColumn/the fixed-slot blocks below — dnd-kit
// keys its droppable registry by id alone, so reusing it here would silently
// overwrite that registration's rect with this section's. `columnId` in
// `data` carries the unprefixed id back out to the drag handlers.
function columnSortableId(id: string): string {
  return `col:${id}`;
}

// Column-move props threaded down from MyWorkSections' `displayOrder` state —
// every column (fixed slot or free) supports left/right reordering, mirroring
// the drag-the-header path 1:1 for keyboard/touch users who have no drag
// gesture available (doc-17 finding #7).
type ColumnMoveProps = { onMoveLeft: () => void; onMoveRight: () => void; canMoveLeft: boolean; canMoveRight: boolean };

function MyWorkColumnShell({
  id,
  title,
  count,
  children,
  onRename,
  freeColumn,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
  // Every column's display name is editable — a free column's own name or a
  // fixed slot's display-name override, depending on which the caller wires up.
  onRename: (name: string) => Promise<void>;
  // Present only for a user-defined free column — adds delete to the header
  // itself (doc-17 #6: editing and reordering now share one surface, the
  // column header, instead of a separate manage panel).
  freeColumn?: MyWorkFreeColumn;
} & ColumnMoveProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnSortableId(id),
    data: { type: "column", columnId: id },
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/20 ${BOARD_COLUMN_HEIGHT_CLASS} ${isDragging ? "opacity-60" : ""}`}
    >
      <header className="flex items-center gap-1 px-3 pt-3 pb-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Reorder ${title} column`}
          // Always visible at a legible contrast (doc-17 #7) rather than
          // hover-gated — a resting-state grip is the only way a mouse user
          // discovers columns are reorderable at all.
          className="cursor-grab text-foreground/70 hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          <ColumnNameField name={title} onRename={onRename} />
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
        {/* Non-drag fallback (doc-17 #7): touch has no keyboard arrow keys and
            no hover, so left/right is the only way to reorder columns there.
            icon-sm (not icon-xs) since this is the touch target. */}
        <div className="flex shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${title} column left`}
            disabled={!canMoveLeft}
            onClick={onMoveLeft}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${title} column right`}
            disabled={!canMoveRight}
            onClick={onMoveRight}
          >
            <ChevronRight />
          </Button>
        </div>
        {/* Separated from the move buttons with its own margin (fable-advisor
            review, principle 6): a destructive action must not sit flush
            beside a routine one. */}
        {freeColumn && (
          <div className="ml-1 shrink-0">
            <DeleteColumnButton columnId={freeColumn.id} name={freeColumn.name} />
          </div>
        )}
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

// An empty column body used to render as a bare strip with no explanation
// (doc-17 #5) — a short muted line instead, in every column that can be
// empty. `text` differs per column kind (fable-advisor review: Done isn't a
// drop target from My Work, so it needs its own wording, not "Drag ..."). Only
// shown when the WHOLE board isn't already empty — the whole-board empty
// state above covers that case in one message instead of repeating per column.
function EmptyColumnHint({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

// A flat draggable column (Today + each free column) — one dnd-kit droppable
// with a plain vertical list. Its own component so the variable number of free
// columns each keep a stable hook count (useDroppable can't run in a loop in
// the parent). Todo/Done keep their own grouped rendering below.
function FlatColumn({
  id,
  title,
  items,
  onRename,
  freeColumn,
  emptyHint,
  ...move
}: {
  id: MyWorkColumnId;
  title: string;
  items: MyWorkDragItem<MyWorkRowData>[];
  onRename: (name: string) => Promise<void>;
  freeColumn?: MyWorkFreeColumn;
  // undefined suppresses the hint (the whole-board empty state already
  // covers it in one message — see EmptyColumnHint's own comment).
  emptyHint?: string;
} & ColumnMoveProps) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <MyWorkColumnShell id={id} title={title} count={items.length} onRename={onRename} freeColumn={freeColumn} {...move}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
          {items.length === 0 && emptyHint && (
            <li>
              <EmptyColumnHint text={emptyHint} />
            </li>
          )}
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id}>
              <MyWorkRow story={item.row} />
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </MyWorkColumnShell>
  );
}

// My Work's Kanban columns (doc-15). Classification is date-scoped to the
// VIEWER's local today (Today = today_date = today), so it runs here on the
// client, not in the server component that fetched the rows: seeded with the
// server's UTC today for a hydration-stable first paint, then corrected to the
// viewer's local wall date on mount (west/east of UTC these differ near
// midnight — doc-15's 09:00 JST boundary note). Reuses this repo's board drag
// machinery (dnd-kit + useOptimisticBoardOrder + board.ts container helpers).
//
// A card drag mostly changes column MEMBERSHIP — onDragEnd calls
// setMyWorkColumn(storyId, targetColumn) once the container changes. Today is
// the one column with its own persisted card order (doc-15 decision 4): a
// same-container drop THERE reorders and writes today_position (TASK-145),
// handled as a separate branch (isTodayReorder) before the cross-column path.
//
// The COLUMNS themselves are also sortable (TASK-148, drag the header to
// reorder — replaces the old up/down buttons). One shared DndContext hosts
// both card drags and column drags; every handler checks
// `event.active.data.current?.type` first ("column" vs "card", tagged by
// MyWorkColumnShell/SortableItem's own useSortable calls) and branches to the
// column-reorder path before falling through to the existing card logic
// unchanged. Column order is tracked as separate local state (`displayOrder`)
// from the card `containers` state, since it persists via its own action
// (saveMyWorkColumnOrder, TASK-141) and needs no per-item revert machinery —
// a failed save just restores the whole array.
export function MyWorkSections({
  assigned,
  completions,
  projects,
  freeColumns,
  order,
  columnNames = DEFAULT_COLUMN_NAMES,
  hasQuickAdd = true,
  serverTodayKey,
}: {
  assigned: MyWorkStory<MyWorkRowData>[];
  completions: DoneEntry<MyWorkRowData>[];
  projects: MyWorkProject[];
  freeColumns: MyWorkFreeColumn[];
  // The viewer's full column display order (TASK-141) — resolveColumnOrder's
  // output, already merged against the live free-column set by the page.
  order: string[];
  // The three fixed slots' display-name overrides (resolveColumnNames'
  // output) — defaults to the plain Todo/Today/Done labels so existing
  // callers/tests don't need updating.
  columnNames?: MyWorkColumnNames;
  // Whether the page actually rendered the quick-add card above (true only
  // for exactly one personal project) — the empty-state copy references it,
  // so it must know when that's not the case (doc-17 #4) instead of always
  // pointing at a control that may not exist. Defaults true so existing
  // callers/tests (which don't exercise this copy) don't need updating.
  hasQuickAdd?: boolean;
  serverTodayKey: string;
}) {
  const todayKey = useSyncExternalStore(NOOP_SUBSCRIBE, localTodayKey, () => serverTodayKey);

  const columns = useMemo(
    () => classifyMyWork(assigned, completions, projects, freeColumns, todayKey),
    [assigned, completions, projects, freeColumns, todayKey],
  );
  const initialContainers = useMemo(() => toDragContainers(columns), [columns]);
  const { containers, setContainers, activeId, beginDrag, endDrag, revertToSnapshot, runDrop } =
    useOptimisticBoardOrder(initialContainers);
  const [dragError, setDragError] = useState<string | null>(null);

  // TASK-148: the column display order, tracked separately from `containers`
  // (card placement). Synced from the `order` prop whenever it changes AND no
  // column drag is in flight — mirrors useOptimisticBoardOrder's own
  // idle-sync-on-reference-change rule; `order` is reference-stable between
  // server refreshes (computed once per server render in page.tsx), so this
  // never fires mid-drag or while a save is pending.
  const [displayOrder, setDisplayOrder] = useState(order);
  const [syncedOrder, setSyncedOrder] = useState(order);
  const [isDraggingColumn, setIsDraggingColumn] = useState(false);
  const [, startColumnReorder] = useTransition();
  if (!isDraggingColumn && syncedOrder !== order) {
    setSyncedOrder(order);
    setDisplayOrder(order);
  }

  const { setNodeRef: setTodoRef } = useDroppable({ id: "todo" });
  const { setNodeRef: setDoneRef } = useDroppable({ id: "done" });

  const sensors = useSensors(
    // Same activation threshold as the board: without it dnd-kit starts a drag
    // on pointerdown and swallows the click that opens the story.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const todoGroups = useMemo(() => regroupByProject(containers.todo ?? []), [containers.todo]);
  const doneGroups = useMemo(() => groupDoneByDate(containers.done ?? []), [containers.done]);

  const totalCount = Object.values(containers).reduce((sum, list) => sum + list.length, 0);

  // Carry-over prompt (doc-15 decision 4): unfinished items whose Today mark is
  // from a past day. Evaluated against the viewer's local today (todayKey is the
  // client's local date after hydration).
  const staleToday = useMemo(
    () => assigned.filter((s) => s.todayDate !== null && s.todayDate < todayKey),
    [assigned, todayKey],
  );
  const [carryResolved, setCarryResolved] = useState(false);
  const [isCarrying, startCarry] = useTransition();

  function resolveCarryOver(carry: boolean) {
    const ids = staleToday.map((s) => s.id);
    setCarryResolved(true);
    startCarry(async () => {
      const result = carry ? await carryOverToday(ids, todayKey) : await dismissCarryOver(ids);
      if (!result.ok) {
        setDragError(result.message);
        setCarryResolved(false);
      }
    });
  }

  // The column the dragged card started in, captured at drag-start — NOT
  // re-derived from `containers` at drag-end (handleDragOver already moved the
  // card into the hovered column, so a re-derived comparison is always equal
  // and would never persist the move — see resolveDragEndTarget's doc comment).
  const dragStartContainer = useRef<MyWorkColumnId | null>(null);

  function isColumnDrag(event: { active: { data: { current?: { type?: string } } } }): boolean {
    return event.active.data.current?.type === "column";
  }

  // Pulls the unprefixed slot id back out of a column drag's `active`/`over`
  // — their dnd-kit id is the namespaced `columnSortableId` form, not the
  // bare id `displayOrder`/`saveMyWorkColumnOrder` deal in.
  function columnIdFrom(entity: { data: { current?: { type?: string; columnId?: string } } } | null | undefined): string | null {
    if (!entity || entity.data.current?.type !== "column") return null;
    return entity.data.current.columnId ?? null;
  }

  function handleDragStart(event: DragStartEvent) {
    if (isColumnDrag(event)) {
      setIsDraggingColumn(true);
      return;
    }
    const id = String(event.active.id);
    dragStartContainer.current = (findContainer(containers, id) as MyWorkColumnId | undefined) ?? null;
    beginDrag(id);
  }

  function handleDragOver(event: DragOverEvent) {
    if (isColumnDrag(event)) {
      // dnd-kit's own horizontalListSortingStrategy already animates the
      // sibling-shift live from the SortableContext's `items` order — no
      // manual state mutation needed until drop (unlike cards, which cross
      // between DIFFERENT arrays/containers and need moveBetweenContainers
      // to move the actual data during the drag itself).
      return;
    }
    const { active, over } = event;
    if (!over) return;
    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer) return;
    // Every column accepts every card (doc-15) EXCEPT Done for a team story:
    // setMyWorkColumn rejects that write outright (a team story completes
    // only on its own board), so letting the drag-over UI accept it first is
    // a false affordance — the card would visibly enter Done, then snap back
    // once the drop is rejected. Gate it here so it's never a valid target to
    // begin with (doc-17 #10).
    setContainers((prev) =>
      moveBetweenContainers(prev, String(active.id), overContainer, String(over.id), (activeId, target) => {
        if (target !== "done") return true;
        return canDropOnDone(storyById(prev, activeId)?.row.isPersonal ?? false);
      }),
    );
  }

  // Shared by the drag-end column branch and the non-drag move buttons
  // (doc-17 #7's touch fallback) — both just compute a new `displayOrder` and
  // persist it the same way.
  function persistColumnOrder(reordered: string[]) {
    setDisplayOrder(reordered);
    setDragError(null);
    startColumnReorder(async () => {
      const result = await saveMyWorkColumnOrder(reordered);
      if (!result.ok) {
        setDisplayOrder(syncedOrder); // revert the whole array — no per-item semantics needed for a flat reorder
        setDragError(result.message);
      }
    });
  }

  // Swaps a column with its immediate left/right neighbour — the keyboard/
  // touch-friendly equivalent of dragging its header one slot over.
  function moveColumn(id: string, direction: "left" | "right") {
    const index = displayOrder.indexOf(id);
    const neighborIndex = direction === "left" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= displayOrder.length) return;
    persistColumnOrder(reorderIds(displayOrder, id, displayOrder[neighborIndex]));
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isColumnDrag(event)) {
      setIsDraggingColumn(false);
      const { active, over } = event;
      const activeColumnId = columnIdFrom(active);
      // Dropped on something that isn't a column (e.g. a card, mid-drag) —
      // no valid target, don't persist a no-op save.
      const overColumnId = over ? columnIdFrom(over) : null;
      if (!activeColumnId || !overColumnId || activeColumnId === overColumnId) return;
      // reorderIds no-ops (returns an equivalent copy) if either id can't be
      // found or the index didn't change — safe to always attempt.
      persistColumnOrder(reorderIds(displayOrder, activeColumnId, overColumnId));
      return;
    }

    endDrag();
    const { active, over } = event;
    const startContainer = dragStartContainer.current;
    dragStartContainer.current = null;
    if (!over) {
      revertToSnapshot();
      return;
    }
    const draggedId = String(active.id);
    const overContainer = (findContainer(containers, String(over.id)) as MyWorkColumnId | undefined) ?? null;
    const item = storyById(containers, draggedId);
    if (!overContainer || !item) {
      revertToSnapshot();
      return;
    }

    if (isManualOrderReorder(startContainer, overContainer)) {
      // reorderContainer no-ops (returns an equivalent copy) when over.id isn't
      // a real neighbour (e.g. dropped on the column's own empty padding) or
      // the index didn't change — safe to always attempt.
      const reordered = reorderContainer(containers[overContainer] ?? [], draggedId, String(over.id));
      setContainers((prev) => ({ ...prev, [overContainer]: reordered }));
      setDragError(null);
      const persist = overContainer === "today" ? reorderMyWorkToday : reorderMyWorkColumn;
      runDrop(
        draggedId,
        async () => {
          const result = await persist(reordered.map((i) => i.storyId));
          if (!result.ok) throw new Error(result.message);
        },
        setDragError,
      );
      return;
    }

    const target = resolveDragEndTarget(startContainer, overContainer);
    if (!target) {
      // Dropped back in the column it started in — nothing to persist.
      return;
    }
    setDragError(null);
    // Deliberately NOT gated the way handleDragOver gates entering Done
    // (canDropOnDone): a team card can still be DROPPED on Done here (it just
    // never visually entered it during the hover) so setMyWorkColumn's
    // rejection surfaces as a dragError banner — spec/screens.md's "Dragging
    // a card" requires a team→Done drop be "rejected with a visible message".
    // Gating it here too would make that drop a silent no-op instead.
    runDrop(
      draggedId,
      async () => {
        const result = await setMyWorkColumn(item.storyId, target, todayKey);
        if (!result.ok) throw new Error(result.message);
      },
      setDragError,
    );
  }

  const activeItem = activeId ? storyById(containers, activeId) : undefined;
  const isEmpty = totalCount === 0;
  const freeColumnById = new Map(freeColumns.map((c) => [c.id, c]));

  // Every column supports left/right move buttons (the non-drag fallback,
  // doc-17 #7) — position looked up fresh each render from `displayOrder`.
  function moveProps(id: string): ColumnMoveProps {
    const index = displayOrder.indexOf(id);
    return {
      onMoveLeft: () => moveColumn(id, "left"),
      onMoveRight: () => moveColumn(id, "right"),
      canMoveLeft: index > 0,
      canMoveRight: index >= 0 && index < displayOrder.length - 1,
    };
  }

  // Renames one of the fixed slots — display label only, the slot id/behavior
  // this component keys everything else off of (classification, drag
  // targets, `displayOrder`) never changes.
  async function renameFixed(slot: "todo" | "today" | "done", name: string) {
    const result = await renameMyWorkFixedColumn(slot, name);
    if (!result.ok) throw new Error(result.message);
  }

  async function renameFree(columnId: string, name: string) {
    const result = await renameMyWorkColumn(columnId, name);
    if (!result.ok) throw new Error(result.message);
  }

  // Todo/Done keep their specialized grouped rendering (per-project / per-date
  // headers); Today and every free column are plain FlatColumns. `displayOrder`
  // (TASK-141/148) decides only the LEFT-TO-RIGHT sequence — the droppable
  // hooks for todo/done stay unconditional above regardless of where they render.
  const todoColumn = (
    <MyWorkColumnShell
      key="todo"
      id="todo"
      title={columnNames.todo}
      count={(containers.todo ?? []).length}
      onRename={(name) => renameFixed("todo", name)}
      {...moveProps("todo")}
    >
      <SortableContext items={(containers.todo ?? []).map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setTodoRef} className="flex min-h-10 flex-1 flex-col gap-3">
          {todoGroups.length === 0 && !isEmpty && <EmptyColumnHint text="Assigned stories appear here." />}
          {todoGroups.map((group) => (
            <div key={group.projectId}>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.projectName}</h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <SortableItem key={item.id} id={item.id}>
                    <MyWorkRow story={item.row} />
                  </SortableItem>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SortableContext>
    </MyWorkColumnShell>
  );

  const doneColumn = (
    <MyWorkColumnShell
      key="done"
      id="done"
      title={columnNames.done}
      count={(containers.done ?? []).length}
      onRename={(name) => renameFixed("done", name)}
      {...moveProps("done")}
    >
      <SortableContext items={(containers.done ?? []).map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setDoneRef} className="flex min-h-10 flex-1 flex-col gap-3">
          {doneGroups.length === 0 && !isEmpty && <EmptyColumnHint text="Completed stories appear here." />}
          {doneGroups.map((group) => (
            <div key={group.dateKey}>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{doneDateLabel(group.dateKey, todayKey)}</h3>
              <ul className="flex flex-col gap-1.5">
                {group.stories.map((item) => (
                  <SortableItem key={item.id} id={item.id}>
                    <MyWorkRow story={item.row} completedAt={item.completedAt} />
                  </SortableItem>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SortableContext>
    </MyWorkColumnShell>
  );

  return (
    <DndContext
      id="my-work-columns"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={(event) => {
        if (isColumnDrag(event)) {
          setIsDraggingColumn(false);
          setDisplayOrder(syncedOrder);
          return;
        }
        endDrag();
        revertToSnapshot();
      }}
    >
      {dragError && (
        <div className="sticky top-0 z-20">
          <MutationErrorBanner message={dragError} onDismiss={() => setDragError(null)} />
        </div>
      )}

      {/* Resolving collapses the prompt SMOOTHLY (grid-rows 1fr->0fr) rather
          than unmounting it — an instant disappearance would jump the columns
          below up and risk a misclick (ux-principles principle 3: a
          warning's appearance/disappearance must not move controls). */}
      {staleToday.length > 0 && (
        <div
          className={`grid transition-all duration-200 ${carryResolved ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
        >
          <div className="overflow-hidden">
            <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <span>
                {staleToday.length} item{staleToday.length === 1 ? "" : "s"} were marked Today on an earlier day.
                Carry them over to today?
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={isCarrying}
                  onClick={() => resolveCarryOver(true)}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Carry over
                </button>
                <button
                  type="button"
                  disabled={isCarrying}
                  onClick={() => resolveCarryOver(false)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Leave in their columns
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          {hasQuickAdd
            ? "Nothing here yet. Stories assigned to you across your projects show up here — add a personal task above, or open a story to plan your day."
            : "Nothing here yet. Stories assigned to you across your projects show up here — add one from a personal project's board, or open a story to plan your day."}
        </p>
      )}

      <SortableContext items={displayOrder.map(columnSortableId)} strategy={horizontalListSortingStrategy}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {displayOrder.map((slotId) => {
            if (slotId === "todo") return todoColumn;
            if (slotId === "today") {
              return (
                <FlatColumn
                  key="today"
                  id="today"
                  title={columnNames.today}
                  items={containers.today ?? []}
                  onRename={(name) => renameFixed("today", name)}
                  emptyHint={isEmpty ? undefined : "Drag stories here to plan today."}
                  {...moveProps("today")}
                />
              );
            }
            if (slotId === "done") return doneColumn;
            const column = freeColumnById.get(slotId);
            if (!column) return null; // stale id — resolveColumnOrder already drops these server-side
            return (
              <FlatColumn
                key={column.id}
                id={column.id}
                title={column.name}
                items={containers[column.id] ?? []}
                onRename={(name) => renameFree(column.id, name)}
                freeColumn={column}
                emptyHint={isEmpty ? undefined : "Drag stories here."}
                {...moveProps(column.id)}
              />
            );
          })}
          {/* Add lives at the end of the row itself now (doc-17 #6):
              add/rename/delete/reorder are all reachable from this one board,
              not split across a separate collapsed manage panel. */}
          <AddColumnTile />
        </div>
      </SortableContext>

      {/* Portal-rendered so the dragged card floats above every column instead
          of being clipped by their overflow-y-auto bodies. */}
      <DragOverlay>
        {activeItem && (
          <div className="w-64 rotate-1 cursor-grabbing">
            {/* completedAt is "" for a non-Done item (falsy, no marker rendered). */}
            <MyWorkRow story={activeItem.row} completedAt={activeItem.completedAt} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
