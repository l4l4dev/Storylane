"use client";

import { useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { quickCreateStory, quickCreateStoryFree } from "@/app/projects/[id]/board/actions";
import { Input } from "@/components/ui/input";

// Pivotal-mode targets, or a free-mode custom status column (Task 14).
export type QuickAddTarget =
  | "backlog"
  | "icebox"
  | "unstarted"
  | { customStatusId: string };

// Inline quick-add composer (spec/screens.md "Board layout"): a `+ Add
// story` row that turns into a title input in place. Enter creates the
// story with defaults and keeps the composer open for consecutive adds;
// Esc (or blurring while empty) closes it. No modal, no navigation —
// every other field is edited afterwards in the story detail.
//
// `compact` (List view — Task 15 follow-up) renders a small text link
// instead of the full dashed box: in a continuous list of rows, a
// full-width "story-shaped" button competed for attention with the actual
// stories, so List view's sections place this in the header instead.
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
      setTitle("");
      setError(null);
      setOpen(false);
    }
  }

  if (!open) {
    if (compact) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
          Add story
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden />
        Add story
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={compact ? "max-w-64" : undefined}>
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
        onBlur={() => {
          if (!title.trim()) {
            setOpen(false);
          }
        }}
        placeholder="Story title — Enter to add"
        aria-label="New story title"
        aria-invalid={error ? true : undefined}
        className={compact ? "h-7 bg-card text-xs" : "h-8 bg-card"}
      />
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error} — press Enter to retry
        </p>
      )}
    </form>
  );
}
