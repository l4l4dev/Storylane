import { useCallback, useMemo, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useProjectEvents } from "../lib/use-project-events";
import { moveStoryTo, orderedIdsFor, type ColumnView } from "../lib/board-ordering";
import { BoardColumn } from "../components/BoardColumn";
import type { StoryView } from "../components/StoryCard";

interface BoardState {
  id: string;
  name: string;
  category: "unstarted" | "in_progress" | "done" | "rejected";
  actionLabel: string | null;
  position: number;
}

interface BoardResponse {
  states: BoardState[];
  columns: Array<{ stateId: string | null; stories: StoryView[] }>;
}

export function BoardPage({ projectId }: { projectId: string }) {
  const board = useResource<BoardResponse>(`/api/projects/${projectId}/board`);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ColumnView[] | null>(null);
  const reload = board.reload;
  useProjectEvents(projectId, useCallback(() => reload(), [reload]));

  // A distance constraint keeps a plain click on a card's button (Start/Finish/Accept/…) from
  // being swallowed: with no constraint, PointerSensor "activates" on pointerdown alone and
  // installs a capture-phase click-swallower on the document to suppress click-after-drag,
  // which fires even for a stationary press.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const columns: ColumnView[] = useMemo(
    () => pending ?? (board.data?.columns ?? []).map((c) => ({ stateId: c.stateId, storyIds: c.stories.map((s) => s.id) })),
    [pending, board.data],
  );

  const storiesById = useMemo(() => {
    const map = new Map<string, StoryView>();
    for (const column of board.data?.columns ?? []) for (const story of column.stories) map.set(story.id, story);
    return map;
  }, [board.data]);

  const gateStates = useMemo(
    () => (board.data?.states ?? []).map((s) => ({ id: s.id, category: s.category, actionLabel: s.actionLabel, position: s.position })),
    [board.data],
  );

  async function commit(next: ColumnView[], storyId: string, targetStateId: string | null) {
    setError(null);
    setPending(next);
    try {
      await apiFetch(`/api/projects/${projectId}/stories/${storyId}/move`, {
        method: "POST",
        body: { stateId: targetStateId, orderedIds: orderedIdsFor(next, targetStateId) },
      });
      setPending(null);
      reload();
    } catch (e) {
      // Every action produces visible feedback, and a refused move snaps back (principle 2).
      setPending(null);
      setError(errorMessage(e));
      reload();
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const storyId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (overId === null) return;
    // dnd-kit reports either a column droppable ("column:<stateId|icebox>") or a sibling card.
    const target = overId.startsWith("column:")
      ? { stateId: overId === "column:icebox" ? null : overId.slice("column:".length), index: Number.MAX_SAFE_INTEGER }
      : (() => {
          const column = columns.find((c) => c.storyIds.includes(overId))!;
          return { stateId: column.stateId, index: column.storyIds.indexOf(overId) };
        })();
    void commit(moveStoryTo(columns, storyId, target.stateId, target.index), storyId, target.stateId);
  }

  function advance(storyId: string, targetStateId: string) {
    void commit(moveStoryTo(columns, storyId, targetStateId, Number.MAX_SAFE_INTEGER), storyId, targetStateId);
  }

  if (board.loading && !board.data) return <main className="p-6 text-sm">Loading the board…</main>;
  if (board.error && !board.data) {
    return (
      <main className="p-6 text-sm" role="alert">
        {errorMessage(board.error)}
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-3 p-4">
      <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto">
          {columns.map((column) => {
            const state = board.data!.states.find((s) => s.id === column.stateId) ?? null;
            return (
              <BoardColumn
                key={column.stateId ?? "icebox"}
                projectId={projectId}
                state={state}
                storyIds={column.storyIds}
                storiesById={storiesById}
                gateStates={gateStates}
                onAdvance={advance}
                onAdded={reload}
              />
            );
          })}
        </div>
      </DndContext>
    </main>
  );
}
