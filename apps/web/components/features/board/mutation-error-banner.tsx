// A rejected/failed board mutation (stale-board drag, RLS-filtered write,
// etc. — spec/screens.md "Conflict & failure rules" sibling for the board
// itself) surfaces here instead of silently leaving the UI
// diverged from the server. Shared by the three board views (List, Kanban,
// Free mode) that each own their own drag state and so each need their own
// error slot.
export function MutationErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
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
