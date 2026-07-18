"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { quickCreateStory } from "@/app/projects/[id]/board/actions";
import { isImeComposing } from "@/lib/utils/keyboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type QuickAddTarget = "backlog" | "icebox" | "unstarted";

// Quick-add composer (spec/screens.md "Quick-add composer"): the
// "+ Add story" trigger stays visible and unchanged — clicking it reveals a
// separate card-shaped composer beneath it, rather than the trigger
// morphing into an input in place. An explicit "Add" button submits (Enter
// also works); Esc or a click outside closes it (discarding whatever was
// typed) and the composer stays open after a successful add for rapid
// consecutive entry; an empty submit is a no-op. No modal, no navigation —
// every other field is edited afterwards in the story detail.
export function QuickAddComposer({
  projectId,
  target,
  beforeItemId,
}: {
  projectId: string;
  target: QuickAddTarget;
  // Backlog-only (TASK-36): inserts the new story immediately before this
  // `"story:<id>"` / `"divider:<id>"` pair — the same convention
  // createBacklogDivider uses — so a per-virtual-iteration-group composer
  // lands its story at that group's bottom instead of the whole backlog's.
  // Omitted (or ignored for other targets) means "append at the end".
  beforeItemId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setTitle("");
    setError(null);
  }

  // Closes on a click anywhere outside the trigger + composer (spec: "Esc
  // or clicking outside closes it"). A plain onBlur can't do this alone —
  // it would also fire e.g. when Tabbing between the input's own controls.
  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // The typed title is kept until creation actually succeeds. Clearing it
  // optimistically before the (void, unawaited) action call would lose the
  // text on failure (e.g. "No active iteration", a DB error) — no story
  // created and no feedback.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("title", trimmed);

    setError(null);
    startTransition(async () => {
      try {
        formData.set("target", target);
        if (target === "backlog" && beforeItemId) {
          formData.set("before_item_id", beforeItemId);
        }
        await quickCreateStory(formData);
        setTitle("");
        inputRef.current?.focus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create story");
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && !isImeComposing(event)) {
      close();
    }
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden />
        Add story
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="rounded-md border border-border bg-popover p-2 shadow-xs">
          <Input
            ref={inputRef}
            autoFocus
            value={title}
            disabled={isPending}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Story title"
            aria-label="New story title"
            aria-invalid={error ? true : undefined}
            className="h-8 bg-card"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button type="submit" size="xs" disabled={isPending || !title.trim()}>
              Add
            </Button>
            <span className="text-xs text-muted-foreground">Esc to close</span>
          </div>
          {error && (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {error} — press Enter to retry
            </p>
          )}
        </form>
      )}
    </div>
  );
}
