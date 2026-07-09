"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { quickCreateStory, quickCreateStoryFree } from "@/app/projects/[id]/board/actions";
import { Input } from "@/components/ui/input";

// Pivotal-mode targets, or a free-mode custom status column (Task 14).
export type QuickAddTarget =
  | "backlog"
  | "icebox"
  | "unstarted"
  | { customStatusId: string };

// Quick-add composer (TASK-11, spec/screens.md "Quick-add composer"): the
// "+ Add story" trigger stays visible and unchanged — clicking it reveals a
// separate card-shaped composer beneath it, rather than the trigger
// morphing into an input in place (the old behavior, which "felt broken").
// Enter creates the story with defaults and keeps the composer open for
// consecutive adds; Esc or a click outside closes it (discarding whatever
// was typed); an empty Enter is a no-op. No modal, no navigation — every
// other field is edited afterwards in the story detail.
//
// `compact` (List view section headers) renders the trigger as a small text
// link instead of the full dashed box — those headers are a single-line
// flex row, so the composer floats as an absolutely-positioned card below
// the trigger instead of pushing the row taller. Non-compact contexts
// (Kanban Unstarted column, free-mode columns) stack it in normal flow.
export function QuickAddComposer({
  projectId,
  target,
  compact = false,
}: {
  projectId: string;
  target: QuickAddTarget;
  compact?: boolean;
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

  // TASK-22: the typed title is kept until creation actually succeeds — it
  // used to be cleared optimistically before the (void, unawaited) action
  // call, so a failure (e.g. "No active iteration", a DB error) lost the
  // text with no story created and no feedback.
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
        if (typeof target === "string") {
          formData.set("target", target);
          await quickCreateStory(formData);
        } else {
          formData.set("status_id", target.customStatusId);
          await quickCreateStoryFree(formData);
        }
        setTitle("");
        inputRef.current?.focus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create story");
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      close();
    }
  }

  return (
    <div ref={containerRef} className={compact ? "relative" : "flex flex-col gap-1.5"}>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
          Add story
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden />
          Add story
        </button>
      )}

      {open && (
        <form
          onSubmit={handleSubmit}
          className={
            compact
              ? "absolute top-full left-0 z-10 mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-md"
              : "rounded-md border border-border bg-popover p-2 shadow-xs"
          }
        >
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
            className={compact ? "h-7 bg-card text-xs" : "h-8 bg-card"}
          />
          {error ? (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {error} — press Enter to retry
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Enter to add · Esc to close</p>
          )}
        </form>
      )}
    </div>
  );
}
