"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createMyWorkColumn, deleteMyWorkColumn, renameMyWorkColumn } from "@/app/my-work/actions";
import type { MyWorkFreeColumn } from "@/lib/utils/my-work";
import { isImeComposing } from "@/lib/utils/keyboard";
import { useInlineEdit } from "@/components/features/board/use-inline-edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Click-to-edit rename field for a free column — same pattern as project
// Settings' StateManager InlineTextField (useInlineEdit is state-model-
// agnostic).
function ColumnNameField({ column }: { column: MyWorkFreeColumn }) {
  const { buttonRef, editor } = useInlineEdit({
    initialValue: column.name,
    fallbackError: "Failed to save",
    shouldCommit: (value) => Boolean(value),
    async onCommit(trimmed) {
      const result = await renameMyWorkColumn(column.id, trimmed);
      if (!result.ok) throw new Error(result.message);
    },
  });

  if (!editor.editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={editor.startEditing}
        aria-label={`Edit name: ${column.name}`}
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

function DeleteColumnButton({ columnId, name }: { columnId: string; name: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={isPending}
        aria-label={`Delete column ${name}`}
        className="text-muted-foreground hover:text-destructive"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await deleteMyWorkColumn(columnId);
            if (!result.ok) setError(result.message);
          });
        }}
      >
        <X />
      </Button>
      {error && <span className="max-w-40 text-right text-xs text-destructive">{error}</span>}
    </div>
  );
}

/**
 * My Work's column management panel (TASK-141, doc-15): add/rename/delete
 * free columns. Reordering (including the fixed Todo/Today/Done slots) now
 * happens by dragging a column's own header directly on the board (TASK-148,
 * replacing this panel's former up/down arrows) — this panel's job shrinks
 * to just the free columns themselves, since the board is now the single
 * place display order lives and is edited.
 */
export function MyWorkColumnManager({ freeColumns }: { freeColumns: MyWorkFreeColumn[] }) {
  const [open, setOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, startAdd] = useTransition();
  const [newName, setNewName] = useState("");

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAddError(null);
    startAdd(async () => {
      const result = await createMyWorkColumn(name);
      if (result.ok) setNewName("");
      else setAddError(result.message);
    });
  }

  return (
    <div className="mx-auto mb-4 max-w-3xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? "Hide column settings" : "Manage columns"}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border p-3">
          {freeColumns.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {freeColumns.map((column) => (
                <li key={column.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <div className="min-w-0 flex-1">
                    <ColumnNameField column={column} />
                  </div>
                  <DeleteColumnButton columnId={column.id} name={column.name} />
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAdd} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-my-work-column-name">New column</Label>
              <Input
                id="new-my-work-column-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                disabled={isAdding}
              />
            </div>
            <Button type="submit" variant="outline" disabled={isAdding || !newName.trim()}>
              Add
            </Button>
          </form>
          {addError && <span className="text-xs text-destructive">{addError}</span>}
        </div>
      )}
    </div>
  );
}
