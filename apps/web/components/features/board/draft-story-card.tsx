"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { createDraftStory, type DraftStoryInput } from "@/app/projects/[id]/board/actions";
import { isImeComposing } from "@/lib/utils/keyboard";
import { Button } from "@/components/ui/button";
import { StoryFields, type StoryFieldsValue } from "@/components/features/story/story-fields";

// The single small "+" a panel header shows (AC#1) — Kanban's unstarted
// column and each of List's Current/Backlog/Icebox panels render exactly
// one of these, toggling a DraftStoryCard open in that panel's body.
export function DraftStoryTrigger({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
      <Plus />
    </Button>
  );
}

const EMPTY_VALUE: StoryFieldsValue = {
  title: "",
  description: "",
  storyType: "feature",
  points: null,
  epicId: "",
  assigneeId: "",
  labelIds: [],
};

// Pivotal-parity inline draft story card (spec/screens.md "Quick-add",
// TASK-82): the panel's own "+" header trigger (not part of this
// component — see KanbanColumn / BoardListView's panel headers) toggles
// this rendered at the top of that panel's list. Full field set via the
// shared StoryFields; local state + explicit Save, unlike
// StoryDetailPanel's autosave — nothing is written until Save. Esc or a
// click outside discards the draft silently (Pivotal parity: no
// confirmation, no partial save, no auto-reopen after a successful save).
export function DraftStoryCard({
  projectId,
  target,
  view,
  beforeItemId,
  pointScale,
  epics,
  members,
  labels,
  onClose,
}: {
  projectId: string;
  target: DraftStoryInput["target"];
  view?: DraftStoryInput["view"];
  // The panel's current first item, so the new story lands at the top
  // (TASK-82 AC#4) — null when the panel is empty.
  beforeItemId: string | null;
  pointScale: number[];
  epics: { id: string; name: string }[];
  members: { id: string; name: string; isAgent?: boolean }[];
  labels: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [value, setValue] = useState<StoryFieldsValue>(EMPTY_VALUE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The trigger lives in a panel header outside the panel's own scroll
  // container (Kanban columns, the Icebox column), which stays visible
  // however far the body is scrolled — so opening the card (always inserted
  // at the body's top) can land it off-screen with no visible sign anything
  // happened (spec/ux-principles.md principle 2). A no-op everywhere else
  // (Current/Backlog have no separate scroll container of their own).
  useEffect(() => {
    containerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // Esc / click-outside discards silently (AC#3).
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose]);

  async function handleSave() {
    if (!value.title.trim() || pending) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await createDraftStory({
      projectId,
      target,
      view,
      beforeItemId,
      title: value.title,
      description: value.description.trim() ? value.description : null,
      storyType: value.storyType,
      points: value.points,
      epicId: value.epicId || null,
      assigneeId: value.assigneeId || null,
      labelIds: value.labelIds,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Pivotal parity (AC#4): the card closes on save, it doesn't reopen.
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSave();
  }

  // Escape and Cmd/Ctrl+S are handled once here rather than per-field
  // (StoryFields' onTextKeyDown is left unwired) — neither individual field
  // stops propagation, so both bubble up from wherever focus is.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isImeComposing(event)) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.key === "s" || event.key === "S") && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSave();
    }
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className="mb-2 rounded-lg border border-border bg-popover p-3 shadow-xs"
    >
      <form onSubmit={handleSubmit}>
        <StoryFields
          value={value}
          onTextChange={(field, v) => setValue((prev) => ({ ...prev, [field]: v }))}
          onDiscreteChange={(field, v) => setValue((prev) => ({ ...prev, [field]: v }))}
          pointScale={pointScale}
          epics={epics}
          members={members}
          labels={labels}
          idPrefix="draft"
          titleAutoFocus
        />
        <div className="mt-3 flex items-center gap-2">
          <Button type="submit" size="xs" disabled={pending || !value.title.trim()}>
            Save
          </Button>
          <span className="text-xs text-muted-foreground">Esc to discard · Cmd/Ctrl+S to save</span>
        </div>
        {error && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
