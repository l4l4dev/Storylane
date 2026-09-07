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
  onAdvance,
  onAdded,
}: {
  projectId: string;
  /** null for the Icebox column. */
  state: ColumnState | null;
  storyIds: string[];
  storiesById: Map<string, StoryView>;
  gateStates: GateState[];
  onAdvance: (storyId: string, targetStateId: string) => void;
  onAdded: () => void;
}) {
  const columnId = `column:${state?.id ?? "icebox"}`;
  const { setNodeRef } = useDroppable({ id: columnId });
  const points = storyIds.reduce((sum, id) => sum + (storiesById.get(id)?.points ?? 0), 0);

  return (
    <div className="flex w-64 shrink-0 flex-col gap-2 rounded border p-2" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium" style={{ color: state ? CATEGORY_TINT[state.category] : undefined }}>
          {state?.name ?? "Icebox"}
        </h2>
        <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>
          <span data-testid={`column-${state?.id ?? "icebox"}-count`}>{storyIds.length}</span>
          {" / "}
          <span data-testid={`column-${state?.id ?? "icebox"}-points`}>{points}</span>
        </span>
      </div>
      {/* The header reserves this row's height in every column so switching columns never
          shifts the cards (principle 3): only the Icebox renders the trigger/form, but every
          column keeps the slot. */}
      <div className="min-h-8">{state === null && <QuickAddCard projectId={projectId} onAdded={onAdded} />}</div>
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
