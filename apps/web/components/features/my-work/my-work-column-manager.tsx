"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createMyWorkColumn, deleteMyWorkColumn } from "@/app/my-work/actions";
import { isImeComposing } from "@/lib/utils/keyboard";
import { useInlineEdit } from "@/components/features/board/use-inline-edit";
import { BOARD_COLUMN_HEIGHT_CLASS } from "@/components/features/board/kanban-columns-board";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * My Work's free-column CRUD controls (doc-15/doc-17). Add, rename, and
 * delete all live inline in the board itself now — this module has no
 * standalone panel of its own; MyWorkSections renders ColumnNameField and
 * DeleteColumnButton in each free column's header, and AddColumnTile at the
 * end of the column row (doc-17 #6: one coherent surface instead of a
 * separate collapsed manage panel + the board's own drag-to-reorder).
 */

// Click-to-edit rename field — same pattern as project Settings' StateManager
// InlineTextField (useInlineEdit is state-model-agnostic). Used for both a
// free column's own name and a fixed slot's display-name override —
// `onRename` is the only thing that differs between them (renameMyWorkColumn
// vs renameMyWorkFixedColumn).
export function ColumnNameField({ name, onRename }: { name: string; onRename: (name: string) => Promise<void> }) {
  const { buttonRef, editor } = useInlineEdit({
    initialValue: name,
    fallbackError: "Failed to save",
    shouldCommit: (value) => Boolean(value),
    onCommit: onRename,
  });

  if (!editor.editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={editor.startEditing}
        aria-label={`Edit name: ${name}`}
        className="w-full truncate rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
      >
        {editor.synced}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        autoFocus
        value={editor.value}
        onChange={(event) => editor.setValue(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void editor.commitAndClose("keyboard");
          } else if (event.key === "Escape") {
            event.preventDefault();
            editor.cancel("keyboard");
          }
        }}
        onBlur={() => void editor.commitAndClose("blur")}
        readOnly={editor.isSaving}
        aria-busy={editor.isSaving || undefined}
        className="h-7 w-full rounded-md border border-border bg-transparent px-1.5 text-sm focus:outline-none disabled:opacity-60"
      />
      {editor.error && <span className="text-xs text-destructive">{editor.error}</span>}
    </div>
  );
}

// Delete asks for confirmation and states the card destination (doc-17 #1):
// deleting used to be a single click with no way back and no explanation of
// where its cards go (they fall back to Todo via the column_id FK's own
// ON DELETE SET NULL — see the delete-column migration/action).
export function DeleteColumnButton({ columnId, name }: { columnId: string; name: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteMyWorkColumn(columnId);
      if (result.ok) setConfirmOpen(false);
      else setError(result.message);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete column ${name}`}
        className="shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
      >
        <X />
      </Button>
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setConfirmOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete column &quot;{name}&quot;?</DialogTitle>
            <DialogDescription>Its cards move to Todo. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete column"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// A "+ Add column" tile at the end of the column row (doc-17 #6) — replaces
// the old standalone "Manage columns" panel; adding a column is now reachable
// from the same board surface as rename/delete/reorder.
export function AddColumnTile() {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await createMyWorkColumn(trimmed);
      if (result.ok) {
        setName("");
        setAdding(false);
      } else {
        setError(result.message);
      }
    });
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className={`flex w-72 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground ${BOARD_COLUMN_HEIGHT_CLASS}`}
      >
        + Add column
      </button>
    );
  }

  return (
    <form
      onSubmit={handleAdd}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 ${BOARD_COLUMN_HEIGHT_CLASS}`}
    >
      <Label htmlFor="new-my-work-column-name">New column</Label>
      <Input
        id="new-my-work-column-name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={isPending}
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" disabled={isPending || !name.trim()}>
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setAdding(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
