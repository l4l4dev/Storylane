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
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { addDays } from "@storylane/core";
import { carryOverToday, dismissCarryOver, setMyWorkColumn } from "@/app/my-work/actions";
import { findContainer, moveBetweenContainers, storyById } from "@/lib/utils/board";
import { formatDate, localTodayKey } from "@/lib/utils/format";
import {
  classifyMyWork,
  groupDoneByDate,
  regroupByProject,
  resolveDragEndTarget,
  toDragContainers,
  type DoneEntry,
  type MyWorkColumnId,
  type MyWorkDragItem,
  type MyWorkFreeColumn,
  type MyWorkProject,
  type MyWorkStory,
} from "@/lib/utils/my-work";
import { BOARD_COLUMN_HEIGHT_CLASS } from "@/components/features/board/kanban-columns-board";
import { MutationErrorBanner } from "@/components/features/board/mutation-error-banner";
import { SortableItem } from "@/components/features/board/sortable-item";
import { useOptimisticBoardOrder } from "@/components/features/board/use-optimistic-board-order";
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
// scrollable body) but without its state-management chrome.
function MyWorkColumnShell({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className={`flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/20 ${BOARD_COLUMN_HEIGHT_CLASS}`}>
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

// A flat draggable column (Today + each free column) — one dnd-kit droppable
// with a plain vertical list. Its own component so the variable number of free
// columns each keep a stable hook count (useDroppable can't run in a loop in
// the parent). Todo/Done keep their own grouped rendering below.
function FlatColumn({ id, title, items }: { id: MyWorkColumnId; title: string; items: MyWorkDragItem<MyWorkRowData>[] }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <MyWorkColumnShell title={title} count={items.length}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
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
// A My Work drag only changes column MEMBERSHIP (no persisted within-column
// order except Today's, written from the drop server-side), so onDragEnd just
// calls setMyWorkColumn(storyId, targetColumn) once the container changes.
export function MyWorkSections({
  assigned,
  completions,
  projects,
  freeColumns,
  serverTodayKey,
}: {
  assigned: MyWorkStory<MyWorkRowData>[];
  completions: DoneEntry<MyWorkRowData>[];
  projects: MyWorkProject[];
  freeColumns: MyWorkFreeColumn[];
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

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    dragStartContainer.current = (findContainer(containers, id) as MyWorkColumnId | undefined) ?? null;
    beginDrag(id);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer) return;
    // Every column accepts every card (doc-15: all columns are valid drop
    // targets), so isAllowed is always true.
    setContainers((prev) => moveBetweenContainers(prev, String(active.id), overContainer, String(over.id), () => true));
  }

  function handleDragEnd(event: DragEndEvent) {
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
    const target = resolveDragEndTarget(startContainer, overContainer);
    if (!target) {
      // Dropped back in the column it started in — nothing to persist.
      return;
    }
    setDragError(null);
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

  return (
    <DndContext
      id="my-work-columns"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
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
                  Not today
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Stories assigned to you across your projects show up here — add a personal task above,
          or open a story to plan your day.
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        <MyWorkColumnShell title="Todo" count={(containers.todo ?? []).length}>
          <SortableContext items={(containers.todo ?? []).map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div ref={setTodoRef} className="flex min-h-10 flex-1 flex-col gap-3">
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

        <FlatColumn id="today" title="Today" items={containers.today ?? []} />

        {freeColumns.map((column) => (
          <FlatColumn key={column.id} id={column.id} title={column.name} items={containers[column.id] ?? []} />
        ))}

        <MyWorkColumnShell title="Done" count={(containers.done ?? []).length}>
          <SortableContext items={(containers.done ?? []).map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div ref={setDoneRef} className="flex min-h-10 flex-1 flex-col gap-3">
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
      </div>

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
