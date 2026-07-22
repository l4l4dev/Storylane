"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  createMyWorkColumn,
  deleteMyWorkColumn,
  renameMyWorkColumn,
  saveMyWorkColumnOrder,
} from "@/app/my-work/actions";
import type { MyWorkFreeColumn } from "@/lib/utils/my-work";
import { isImeComposing } from "@/lib/utils/keyboard";
import { useInlineEdit } from "@/components/features/board/use-inline-edit";
import { MutationErrorBanner } from "@/components/features/board/mutation-error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FIXED_LABELS: Record<string, string> = { todo: "Todo", today: "Today", done: "Done" };

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
 * free columns, and reorder ALL slots — Todo/Today/Done included, per doc-15
 * ("the order covers the three fixed slots too"). Mirrors project Settings'
 * StateManager (up/down arrows, inline rename, X-button delete, add form) —
 * the same low-risk, no-drag reorder pattern, since this is a small,
 * infrequently-touched list, not the board's story drag surface.
 *
 * `order` is the fully resolved slot-id sequence (lib/utils/my-work.ts
 * resolveColumnOrder) computed server-side from `profiles.my_work_column_order`
 * merged against the live free-column set — this component only ever swaps two
 * ADJACENT entries and persists the whole array; it never needs to know which
 * ids are "new" or "stale" (the next server round-trip re-resolves that).
 */
export function MyWorkColumnManager({ order, freeColumns }: { order: string[]; freeColumns: MyWorkFreeColumn[] }) {
  const [open, setOpen] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  // Disables EVERY row's arrows while a reorder is saving — not just the
  // clicked row's: move() computes `next` from the `order` prop, which stays
  // stale until the save's revalidate lands, so a second click on a DIFFERENT
  // row during that window would compute from the same stale array and
  // silently clobber the first move on save (fable-advisor, TASK-141).
  const [isReordering, setIsReordering] = useState(false);
  const [, startReorder] = useTransition();
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, startAdd] = useTransition();
  const [newName, setNewName] = useState("");

  const columnById = new Map(freeColumns.map((c) => [c.id, c]));

  function move(slotId: string, direction: "up" | "down") {
    const index = order.indexOf(slotId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= order.length) return;
    const next = [...order];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];

    setReorderError(null);
    setIsReordering(true);
    startReorder(async () => {
      const result = await saveMyWorkColumnOrder(next);
      if (!result.ok) setReorderError(result.message);
      setIsReordering(false);
    });
  }

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
          {reorderError && <MutationErrorBanner message={reorderError} onDismiss={() => setReorderError(null)} />}
          <ul className="flex flex-col gap-1.5">
            {order.map((slotId, index) => {
              const isFixed = slotId in FIXED_LABELS;
              const column = columnById.get(slotId);
              const name = isFixed ? FIXED_LABELS[slotId] : (column?.name ?? slotId);
              return (
                <li key={slotId} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <div className="flex shrink-0 flex-col">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === 0 || isReordering}
                      aria-label={`Move ${name} up`}
                      onClick={() => move(slotId, "up")}
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === order.length - 1 || isReordering}
                      aria-label={`Move ${name} down`}
                      onClick={() => move(slotId, "down")}
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </div>

                  <div className="min-w-0 flex-1">
                    {isFixed ? (
                      <span className="block truncate px-1.5 py-1 text-sm text-muted-foreground">{name}</span>
                    ) : column ? (
                      <ColumnNameField column={column} />
                    ) : (
                      <span className="block truncate px-1.5 py-1 text-sm text-muted-foreground italic">Unknown</span>
                    )}
                  </div>

                  {!isFixed && column && <DeleteColumnButton columnId={column.id} name={column.name} />}
                </li>
              );
            })}
          </ul>

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
