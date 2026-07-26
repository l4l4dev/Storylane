"use client";

import { useInlineEdit } from "@/components/features/board/use-inline-edit";
import { DraftStoryTrigger } from "@/components/features/board/draft-story-card";
import { isImeComposing } from "@/lib/utils/keyboard";

// Inline "+ Add Epic" (doc-20 §1 tracker parity: top-down creation), shared by
// the List view's Epics band and /epics (AC#5) — both just need "create an
// epic with this title", the caller decides what happens after (the band
// expands itself and the new row; /epics navigates to it).
// resetAfterCommit clears the field back to blank on success, ready for the
// next add. Blur discards silently rather than committing, matching
// DraftStoryCard's quick-add convention (Esc/click-outside never partial-
// saves) — a real epic row would otherwise get created just by clicking
// elsewhere on the page mid-type.
export function AddEpicButton({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const { editor } = useInlineEdit({
    initialValue: "",
    fallbackError: "Failed to create epic",
    shouldCommit: (value) => value.length > 0,
    resetAfterCommit: true,
    onCommit: onCreate,
  });

  if (!editor.editing) {
    return <DraftStoryTrigger label="Add epic" onClick={editor.startEditing} />;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        autoFocus
        value={editor.value}
        onChange={(event) => editor.setValue(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) {
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void editor.commitAndClose("keyboard");
          } else if (event.key === "Escape") {
            event.preventDefault();
            editor.cancel("keyboard");
          }
        }}
        onBlur={() => editor.cancel("blur")}
        placeholder="Epic title"
        aria-label="New epic title"
        readOnly={editor.isSaving}
        aria-busy={editor.isSaving || undefined}
        className="h-7 w-40 truncate rounded border border-border bg-transparent px-1.5 text-xs focus:outline-none"
      />
      {editor.error && <span className="shrink-0 text-xs text-destructive">{editor.error}</span>}
    </div>
  );
}
