"use client";

import { useMemo, useState } from "react";
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
import { setMyWorkColumn } from "@/app/my-work/actions";
import { findContainer, moveBetweenContainers, storyById } from "@/lib/utils/board";
import { formatDate, utcTodayKey } from "@/lib/utils/format";
import {
  groupDoneByDate,
  regroupByProject,
  toDragContainers,
  type MyWorkColumn,
  type MyWorkColumns,
} from "@/lib/utils/my-work";
import { BOARD_COLUMN_HEIGHT_CLASS } from "@/components/features/board/kanban-columns-board";
import { MutationErrorBanner } from "@/components/features/board/mutation-error-banner";
import { SortableItem } from "@/components/features/board/sortable-item";
import { useOptimisticBoardOrder } from "@/components/features/board/use-optimistic-board-order";
import { MyWorkRow, type MyWorkRowData } from "./my-work-row";

function doneDateLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === addDays(todayKey, -1)) return "Yesterday";
  return formatDate(dateKey);
}

const COLUMN_TITLES: Record<MyWorkColumn, string> = { todo: "Todo", today: "Today", doing: "Doing", done: "Done" };

// One My Work Kanban column shell (doc-14, TASK-132) — mirrors
// kanban-columns-board.tsx's KanbanColumn (tinted header, independently
// scrollable body) but without its state-management chrome (rename/add-column/
// draft-story), none of which applies to My Work's fixed four semantic columns.
function MyWorkColumnShell({
  column,
  count,
  children,
}: {
  column: MyWorkColumn;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/20 ${BOARD_COLUMN_HEIGHT_CLASS}`}>
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold">{COLUMN_TITLES[column]}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

// My Work's four Kanban columns (doc-14 "Dragging a card"), reusing this
// repo's board drag machinery (dnd-kit sensors/DndContext/DragOverlay,
// useOptimisticBoardOrder's snapshot+per-card revert, board.ts's generic
// container helpers, SortableItem, MutationErrorBanner — TASK-132 AC #1)
// rather than a new drag implementation. Classification (which column a
// story lands in) stays entirely server-side (my-work/page.tsx); this
// component only turns that into a flat per-column drag surface
// (toDragContainers) and re-derives Todo's project / Done's date headers
// from whatever order is currently live (regroupByProject / groupDoneByDate)
// so a mid-drag reorder degrades gracefully instead of crashing.
//
// Unlike the board, a My Work drag never reorders within a column (no
// persisted position) — only column MEMBERSHIP changes, so onDragEnd skips
// the board's reorderContainer/beforeAnchorId step entirely and just calls
// setMyWorkColumn(storyId, targetColumn) once the story's container actually
// changes.
export function MyWorkSections({ columns }: { columns: MyWorkColumns<MyWorkRowData> }) {
  const initialContainers = useMemo(() => toDragContainers(columns), [columns]);
  const { containers, setContainers, activeId, beginDrag, endDrag, revertToSnapshot, runDrop } =
    useOptimisticBoardOrder(initialContainers);
  const [dragError, setDragError] = useState<string | null>(null);
  const todayKey = utcTodayKey();

  const { setNodeRef: setTodoRef } = useDroppable({ id: "todo" });
  const { setNodeRef: setTodayRef } = useDroppable({ id: "today" });
  const { setNodeRef: setDoingRef } = useDroppable({ id: "doing" });
  const { setNodeRef: setDoneRef } = useDroppable({ id: "done" });

  const sensors = useSensors(
    // Same activation threshold as the board: without it dnd-kit starts a
    // drag on pointerdown and swallows the click that opens the story.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const todoGroups = useMemo(() => regroupByProject(containers.todo), [containers.todo]);
  const doneGroups = useMemo(() => groupDoneByDate(containers.done), [containers.done]);

  const totalCount = containers.todo.length + containers.today.length + containers.doing.length + containers.done.length;

  function handleDragStart(event: DragStartEvent) {
    beginDrag(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer) return;
    // Every column accepts every card (doc-14: all four are valid drop
    // targets, mapped or not) — unlike the board there's no gating rule, so
    // isAllowed is always true.
    setContainers((prev) => moveBetweenContainers(prev, String(active.id), overContainer, String(over.id), () => true));
  }

  function handleDragEnd(event: DragEndEvent) {
    endDrag();
    const { active, over } = event;
    if (!over) {
      revertToSnapshot();
      return;
    }
    const activeId = String(active.id);
    const overContainer = findContainer(containers, String(over.id)) as MyWorkColumn | undefined;
    const currentContainer = findContainer(containers, activeId) as MyWorkColumn | undefined;
    const item = storyById(containers, activeId);
    if (!overContainer || !currentContainer || !item) {
      revertToSnapshot();
      return;
    }
    if (currentContainer === overContainer) {
      // Dropped back where it started — nothing changed, no server call
      // (My Work has no intra-column ordering to persist).
      return;
    }
    setDragError(null);
    runDrop(
      activeId,
      async () => {
        const result = await setMyWorkColumn(item.storyId, overContainer);
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

      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Stories assigned to you across your projects show up here — add a
          personal task above, or open a story to plan your day.
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        <MyWorkColumnShell column="todo" count={containers.todo.length}>
          <SortableContext items={containers.todo.map((i) => i.id)} strategy={verticalListSortingStrategy}>
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

        <MyWorkColumnShell column="today" count={containers.today.length}>
          <SortableContext items={containers.today.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul ref={setTodayRef} className="flex min-h-10 flex-1 flex-col gap-2">
              {containers.today.map((item) => (
                <SortableItem key={item.id} id={item.id}>
                  <MyWorkRow story={item.row} />
                </SortableItem>
              ))}
            </ul>
          </SortableContext>
        </MyWorkColumnShell>

        <MyWorkColumnShell column="doing" count={containers.doing.length}>
          <SortableContext items={containers.doing.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul ref={setDoingRef} className="flex min-h-10 flex-1 flex-col gap-2">
              {containers.doing.map((item) => (
                <SortableItem key={item.id} id={item.id}>
                  <MyWorkRow story={item.row} />
                </SortableItem>
              ))}
            </ul>
          </SortableContext>
        </MyWorkColumnShell>

        <MyWorkColumnShell column="done" count={containers.done.length}>
          <SortableContext items={containers.done.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div ref={setDoneRef} className="flex min-h-10 flex-1 flex-col gap-3">
              {doneGroups.map((group) => (
                <div key={group.dateKey}>
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                    {doneDateLabel(group.dateKey, todayKey)}
                  </h3>
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

      {/* Portal-rendered so the dragged card floats above every column
          instead of being clipped by their overflow-y-auto bodies (see
          kanban-columns-board.tsx's identical DragOverlay). */}
      <DragOverlay>
        {activeItem && (
          <div className="w-64 rotate-1 cursor-grabbing">
            {/* completedAt is "" for a non-Done item (falsy, no marker rendered) — see MyWorkDragItem's doc comment. */}
            <MyWorkRow story={activeItem.row} completedAt={activeItem.completedAt} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
