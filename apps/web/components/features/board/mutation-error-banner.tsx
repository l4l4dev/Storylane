import type { ReactNode } from "react";

// A rejected/failed board mutation (stale-board drag, RLS-filtered write,
// etc. — spec/screens.md "Conflict & failure rules" sibling for the board
// itself) surfaces here instead of silently leaving the UI diverged from the
// server. Shared by the board's two views (List, Kanban), each of which owns
// its own drag state and so needs its own error slot. `message` is a ReactNode
// so My Work can embed a link (a team story rejected out of Done links to its
// board — TASK-173, principle 8); the board's own callers still pass a string.
export function MutationErrorBanner({ message, onDismiss }: { message: ReactNode; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="mb-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 underline">
        Dismiss
      </button>
    </div>
  );
}
