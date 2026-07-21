"use client";

import { useRef, useState, useTransition } from "react";
import { restoreItemPosition } from "@/lib/utils/board";

// Shared optimistic-order state machine for both board views
// (kanban-columns-board + board-list-view), which otherwise duplicated it and
// drifted apart (doc-13 findings #4/#5, TASK-113). It owns:
//   - `containers`: the optimistic order shown during/after a drag
//   - reconcile from the server value, DEFERRED while a drag is active or a
//     drop is still saving — a realtime router.refresh() mid-drag must not
//     yank dnd-kit's dragged node (finding #5), and the reconcile right after
//     a drag must not revert the just-made move before its own save lands
//     (isPending stays true across the server action + revalidate)
//   - per-drag snapshot + reverts: the whole board for a synchronous
//     invalid/cancelled drop, but only the dragged item for an async server
//     rejection, so a sibling drag still in flight survives (finding #4)
//
// `serverContainers` is BOTH the value to reconcile to and the change token —
// its identity must be reference-stable across renders that aren't a server
// refresh (the raw prop for kanban; a useMemo'd derived map for the list view,
// whose backlog rows + states fold in and change the reference in lockstep).
export function useOptimisticBoardOrder<T extends { id: string }>(serverContainers: Record<string, T[]>) {
  const [containers, setContainers] = useState(serverContainers);
  const [synced, setSynced] = useState(serverContainers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const preDragRef = useRef<Record<string, T[]> | null>(null);

  if (activeId === null && !isPending && synced !== serverContainers) {
    setSynced(serverContainers);
    setContainers(serverContainers);
  }

  function beginDrag(id: string) {
    preDragRef.current = containers;
    setActiveId(id);
  }

  function endDrag() {
    setActiveId(null);
  }

  // Synchronous invalid/cancelled drop: nothing was sent, so restore the whole
  // pre-drag board (a concurrent realtime change, if any, reconciles right
  // after since no drop keeps isPending true).
  function revertToSnapshot() {
    if (preDragRef.current) {
      setContainers(preDragRef.current);
    }
  }

  // Runs the drop inside this hook's transition so isPending gates the
  // reconcile until the server action + its revalidate have committed. On
  // rejection reverts ONLY this item to its pre-drag slot (a sibling drag
  // still in flight survives), using a snapshot captured synchronously here —
  // NOT read in the async catch, where an overlapping later drag's beginDrag
  // would have overwritten the ref.
  function runDrop(id: string, action: () => Promise<void>, onError: (message: string) => void) {
    const snapshot = preDragRef.current;
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        if (snapshot) {
          setContainers((prev) => restoreItemPosition(prev, snapshot, id));
        }
        onError(err instanceof Error ? err.message : "Failed to move the story");
      }
    });
  }

  return { containers, setContainers, activeId, beginDrag, endDrag, revertToSnapshot, runDrop };
}
