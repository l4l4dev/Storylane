import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { GateState } from "@storylane/core";
import { buttonClass } from "./Field";
import { QuickAddCard } from "./QuickAddCard";
import { StoryCard, type StoryView } from "./StoryCard";

interface ColumnState {
  id: string;
  name: string;
  category: "unstarted" | "in_progress" | "done" | "rejected";
  actionLabel: string | null;
  position: number;
}

const CATEGORY_TINT: Record<ColumnState["category"], string> = {
  done: "var(--success, seagreen)",
  rejected: "var(--danger)",
  unstarted: "var(--ink-muted)",
  in_progress: "var(--ink-muted)",
};

export function BoardColumn({
  projectId,
  state,
  storyIds,
  storiesById,
  gateStates,
  scaleValues,
  showQuickAdd,
  canWrite,
  onAdvance,
  onAdded,
}: {
  projectId: string;
  /** null for the Icebox column. */
  state: ColumnState | null;
  storyIds: string[];
  storiesById: Map<string, StoryView>;
  gateStates: GateState[];
  scaleValues: number[];
  /** True on the Icebox and the first `unstarted` column (spec/screens.md "Kanban view"). */
  showQuickAdd: boolean;
  /** False for a viewer: no quick-add, no card controls, no dragging (principle 1). */
  canWrite: boolean;
  onAdvance: (storyId: string, targetStateId: string) => void;
  onAdded: () => void;
}) {
  const columnKey = state?.id ?? "icebox";
  const columnId = `column:${columnKey}`;
  const { setNodeRef } = useDroppable({ id: columnId });
  const points = storyIds.reduce((sum, id) => sum + (storiesById.get(id)?.points ?? 0), 0);
  const isIcebox = state === null;
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const canAdd = showQuickAdd && canWrite;

  return (
    <div
      data-testid={`column-${columnKey}`}
      className="flex w-64 shrink-0 flex-col gap-2 rounded border p-2"
      style={{
        borderColor: "var(--line)",
        background: isIcebox ? "var(--surface-2)" : undefined,
        // The Icebox stays a real column in phase 1 (spec/screens.md's Kanban view has none, but
        // there is no List view yet to hold its stories) — this divider goes away once the List
        // view ships and the Icebox moves there.
        borderRight: isIcebox ? "2px solid var(--line)" : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium" style={{ color: state ? CATEGORY_TINT[state.category] : undefined }}>
            {state?.name ?? "Icebox"}
          </h2>
          {/* Only the trigger lives in the header — the form itself is an overlay below,
              docked over the card list, so opening it never pushes a card or its buttons down
              (ux-principles #3). */}
          {canAdd && !quickAddOpen && (
            <button type="button" className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => setQuickAddOpen(true)}>
              + Add a story
            </button>
          )}
        </div>
        <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>
          <span data-testid={`column-${columnKey}-count`}>{storyIds.length}</span>
          {" / "}
          <span data-testid={`column-${columnKey}-points`}>{points}</span>
        </span>
      </div>
      <div style={{ position: "relative" }}>
        {canAdd && quickAddOpen && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}>
            <QuickAddCard
              projectId={projectId}
              stateId={state?.id ?? null}
              scaleValues={scaleValues}
              onAdded={onAdded}
              onClose={() => setQuickAddOpen(false)}
            />
          </div>
        )}
        <SortableContext items={storyIds} strategy={verticalListSortingStrategy}>
          <ul ref={setNodeRef} className="flex min-h-8 flex-col gap-2">
            {storyIds.map((id) => {
              const story = storiesById.get(id);
              if (!story) return null;
              return (
                <StoryCard
                  key={id}
                  projectId={projectId}
                  story={story}
                  states={gateStates}
                  scaleValues={scaleValues}
                  canWrite={canWrite}
                  onAdvance={(target) => onAdvance(id, target)}
                  onEstimated={onAdded}
                />
              );
            })}
          </ul>
        </SortableContext>
      </div>
    </div>
  );
}
