import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { computeStateGate, type GateState } from "@storylane/core";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass } from "./Field";
import { PointButtons } from "./PointButtons";

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
  scaleValues,
  onAdvance,
  onEstimated,
}: {
  projectId: string;
  story: StoryView;
  states: GateState[];
  /** The project's point scale, resolved once in BoardPage. */
  scaleValues: number[];
  onAdvance: (targetStateId: string) => void;
  onEstimated: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: story.id });
  const gate = computeStateGate(states, story.stateId);
  const [showPoints, setShowPoints] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Points are feature-only in this UI (packages/core's storyTypeUsesPoints also allows `bug`,
  // since a bug's points are optional and stored, but phase 1 gives it no estimate control here).
  const isFeature = story.storyType === "feature";
  const targetCategory = gate.kind === "advance" ? (states.find((s) => s.id === gate.targetStateId)?.category ?? null) : null;
  // Pivotal behaviour: an unestimated feature whose only move is out of an unstarted-category
  // state shows the point row in place of the advance button — there is nothing else to click
  // that wouldn't just bounce off the server's estimate gate (no dead controls, principle 1).
  const blockedUnestimated = isFeature && story.points === null && gate.kind === "advance" && targetCategory !== null && targetCategory !== "unstarted";

  async function selectPoints(points: number) {
    setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/stories/${story.id}`, { method: "PATCH", body: { points } });
      setShowPoints(false);
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
        {isFeature && story.points !== null && (
          // The badge toggles the same point-button row open, so re-estimating never needs a
          // separate control.
          <button
            type="button"
            className="mono underline decoration-dotted"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setShowPoints((v) => !v)}
          >
            {story.points}
          </button>
        )}
        {!isFeature && story.points !== null && <span className="mono">{story.points}</span>}
      </div>
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {isFeature && (blockedUnestimated || showPoints) ? (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <PointButtons scaleValues={scaleValues} value={story.points} onSelect={selectPoints} />
        </div>
      ) : (
        <>
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
        </>
      )}
    </li>
  );
}
