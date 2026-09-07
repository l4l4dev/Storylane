import { useCallback, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { pointScaleValues } from "@storylane/core";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useProjectEvents } from "../lib/use-project-events";
import { isNoopMove, moveStoryTo, orderedIdsFor, type ColumnView } from "../lib/board-ordering";
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

interface ProjectDetail {
  // Web has no server-side dependency, so this mirrors apps/server/src/db/schema/projects.ts's
  // POINT_SCALES rather than importing a server-only type.
  pointScale: "fibonacci" | "linear" | "custom";
  customPoints: number[] | null;
  role: "owner" | "member" | "viewer";
}

export function BoardPage({ projectId }: { projectId: string }) {
  const board = useResource<BoardResponse>(`/api/projects/${projectId}/board`);
  const project = useResource<ProjectDetail>(`/api/projects/${projectId}`);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ColumnView[] | null>(null);
  const reload = board.reload;
  // A transient failure here just means the next SSE event or user action tries again — nothing
  // here awaits this call, so an unhandled rejection would otherwise surface as console noise.
  const reloadQuietly = useCallback(() => void reload().catch(() => {}), [reload]);
  useProjectEvents(projectId, reloadQuietly);

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

  // Until the project's own fetch lands the role is unknown, and a control that turns out to be
  // a 403 is worse than one that appears a moment late (ux-principles #1).
  const canWrite = project.data !== undefined && project.data.role !== "viewer";

  const scaleValues = useMemo(
    () => pointScaleValues(project.data?.pointScale ?? "fibonacci", project.data?.customPoints ?? null),
    [project.data],
  );

  // The first unstarted-category column also gets a quick-add, alongside the Icebox
  // (spec/screens.md "Kanban view"): lowest `position` among unstarted states.
  const firstUnstartedId = useMemo(() => {
    const unstarted = (board.data?.states ?? []).filter((s) => s.category === "unstarted");
    unstarted.sort((a, b) => a.position - b.position);
    return unstarted[0]?.id ?? null;
  }, [board.data]);

  // Guards against a rapid second drag "losing" to a slower first one: only the *latest*
  // commit() is allowed to touch `pending`/`error` once its awaits resolve. Without this, a
  // superseded reload settling late (see use-resource.ts's `reload` — a superseded call
  // resolves rather than hangs, so an SSE echo of our own move can't leak `pending` forever)
  // could clear `pending` on behalf of a move that isn't the most recent one anymore.
  const moveSeqRef = useRef(0);

  async function commit(next: ColumnView[], storyId: string, targetStateId: string | null) {
    const mySeq = ++moveSeqRef.current;
    setError(null);
    setPending(next);
    try {
      await apiFetch(`/api/projects/${projectId}/stories/${storyId}/move`, {
        method: "POST",
        body: { stateId: targetStateId, orderedIds: orderedIdsFor(next, targetStateId) },
      });
    } catch (e) {
      // Rollback: drop the optimistic view and show the error. The board never changed
      // server-side, so there is nothing new to refetch (principle 2).
      if (mySeq === moveSeqRef.current) {
        setPending(null);
        setError(errorMessage(e));
      }
      return;
    }
    try {
      // The move is committed server-side now. Keep the optimistic view up until this refresh
      // (or whatever newer one supersedes it) actually confirms it, so the board never flickers
      // back to the pre-move layout in between (principle 3).
      await reload();
      if (mySeq === moveSeqRef.current) setPending(null);
    } catch (e) {
      // The move succeeded, but we couldn't confirm the board reflects it — release the
      // optimistic view rather than leave it stuck, and surface the refetch's own error.
      if (mySeq === moveSeqRef.current) {
        setPending(null);
        setError(errorMessage(e));
      }
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!canWrite) return;
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
    // Dropping a card back on its own slot is a no-op — skip the network call entirely.
    if (isNoopMove(columns, storyId, target.stateId, target.index)) return;
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
            // An empty rejected-category column stays out of the way (advisor phase-1 must).
            if (state?.category === "rejected" && column.storyIds.length === 0) return null;
            return (
              <BoardColumn
                key={column.stateId ?? "icebox"}
                projectId={projectId}
                state={state}
                storyIds={column.storyIds}
                storiesById={storiesById}
                gateStates={gateStates}
                scaleValues={scaleValues}
                showQuickAdd={column.stateId === null || column.stateId === firstUnstartedId}
                canWrite={canWrite}
                onAdvance={advance}
                onAdded={reloadQuietly}
              />
            );
          })}
        </div>
      </DndContext>
    </main>
  );
}
