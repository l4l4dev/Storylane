import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { GateState } from "@storylane/core";
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
  onAdvance: (storyId: string, targetStateId: string) => void;
  onAdded: () => void;
}) {
  const columnKey = state?.id ?? "icebox";
  const columnId = `column:${columnKey}`;
  const { setNodeRef } = useDroppable({ id: columnId });
  const points = storyIds.reduce((sum, id) => sum + (storiesById.get(id)?.points ?? 0), 0);
  // The Icebox stays a real column in phase 1 because there is no List view yet to hold its
  // stories (spec/screens.md); it goes dim-background-and-divider treatment goes away once the
  // List view ships and the Icebox moves there.
  const isIcebox = state === null;

  return (
    <div
      data-testid={`column-${columnKey}`}
      className="flex w-64 shrink-0 flex-col gap-2 rounded border p-2"
      style={{ borderColor: "var(--line)", background: isIcebox ? "var(--surface-2)" : undefined }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2" style={isIcebox ? { borderRight: "2px solid var(--line)", paddingRight: 4 } : undefined}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium" style={{ color: state ? CATEGORY_TINT[state.category] : undefined }}>
            {state?.name ?? "Icebox"}
          </h2>
          {showQuickAdd && (
            <QuickAddCard projectId={projectId} stateId={state?.id ?? null} scaleValues={scaleValues} onAdded={onAdded} />
          )}
        </div>
        <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>
          <span data-testid={`column-${columnKey}-count`}>{storyIds.length}</span>
          {" / "}
          <span data-testid={`column-${columnKey}-points`}>{points}</span>
        </span>
      </div>
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
                onAdvance={(target) => onAdvance(id, target)}
                onEstimated={onAdded}
              />
            );
          })}
        </ul>
      </SortableContext>
    </div>
  );
}
