import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { computeStateGate, type GateState } from "@storylane/core";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass } from "./Field";

export interface StoryView {
  id: string;
  number: number;
  title: string;
  storyType: "feature" | "bug" | "chore" | "release";
  stateId: string | null;
  points: number | null;
  completedAt: number | null;
}

/**
 * The one-click advance button (or Accept/Reject pair, or Restart) is computed by
 * packages/core from the project's states — never from a state name.
 */
export function StoryCard({
  projectId,
  story,
  states,
  onAdvance,
  onEstimated,
}: {
  projectId: string;
  story: StoryView;
  states: GateState[];
  onAdvance: (targetStateId: string) => void;
  onEstimated: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: story.id });
  const gate = computeStateGate(states, story.stateId);
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState(String(story.points ?? ""));
  const [error, setError] = useState<string | null>(null);

  async function submitPoints(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/stories/${story.id}`, {
        method: "PATCH",
        body: { points: points === "" ? null : Number(points) },
      });
      setEditing(false);
      onEstimated();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, borderColor: "var(--line)" }}
      className="flex flex-col gap-1 rounded border bg-[var(--surface)] p-2"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{story.title}</span>
        <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>#{story.number}</span>
      </div>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
        <span>{story.storyType}</span>
        {editing ? (
          <form onSubmit={submitPoints} className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <input
              autoFocus
              type="number"
              aria-label="Points"
              className="mono w-12 rounded border px-1"
              style={{ borderColor: "var(--line)" }}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
            <button type="submit" className={buttonClass} style={{ borderColor: "var(--line)" }}>
              Save
            </button>
            <button
              type="button"
              className={buttonClass}
              style={{ borderColor: "var(--line)" }}
              onClick={() => {
                setPoints(String(story.points ?? ""));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="mono underline decoration-dotted"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setEditing(true)}
          >
            {story.points ?? "estimate"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {/* No dead controls: when there is no advance, nothing is rendered (principle 1). */}
      {gate.kind === "advance" && (
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.targetStateId)}>
          {gate.label}
        </button>
      )}
      {gate.kind === "accept-reject" && (
        <div className="flex gap-1">
          <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.acceptStateId)}>
            {gate.acceptLabel}
          </button>
          {gate.rejectStateId !== null && (
            <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.rejectStateId!)}>
              Reject
            </button>
          )}
        </div>
      )}
      {gate.kind === "restart" && gate.targetStateId !== null && (
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.targetStateId!)}>
          Restart
        </button>
      )}
    </li>
  );
}
