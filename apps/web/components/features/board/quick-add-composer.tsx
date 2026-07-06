"use client";

import { useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { quickCreateStory } from "@/app/projects/[id]/board/actions";
import { Input } from "@/components/ui/input";

export type QuickAddTarget = "backlog" | "icebox" | "unstarted";

// Inline quick-add composer (spec/screens.md "Board layout"): a `+ Add
// story` row that turns into a title input in place. Enter creates the
// story with defaults and keeps the composer open for consecutive adds;
// Esc (or blurring while empty) closes it. No modal, no navigation —
// every other field is edited afterwards in the story detail.
export function QuickAddComposer({
  projectId,
  target,
}: {
  projectId: string;
  target: QuickAddTarget;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("title", trimmed);
    formData.set("target", target);

    setTitle("");
    startTransition(() => {
      void quickCreateStory(formData);
    });
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setTitle("");
      setOpen(false);
    }
  }

  if (!open) {
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
    <form onSubmit={handleSubmit}>
      <Input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!title.trim()) {
            setOpen(false);
          }
        }}
        placeholder="Story title — Enter to add"
        aria-label="New story title"
        className="h-8 bg-card"
      />
    </form>
  );
}
