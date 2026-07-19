"use client";

import { useState, useTransition } from "react";
import { estimateStory, setStoryState } from "@/app/projects/[id]/board/actions";
import { computeStateGate, type StateCategory } from "@storylane/core";
import { formatPoints, isUnestimatedFeature } from "@/lib/utils/stories";
import { toGateStates } from "@/lib/utils/kanban";
import type { ActionResult, ProjectState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ButtonSpec = { key: string; label: string; targetStateId: string };

// One-click state-transition buttons (advance / Accept / Reject / Restart —
// see spec/screens.md "Story card UX"). Shared by the story card (always
// visible) and the story detail panel (standalone page + board inline
// expansion), so the transition rules live in one place. The offered
// button(s) are computed by `computeStateGate` (packages/core) from the
// project's states — the DB permits any->any within the project, this is
// the UI-owned ordering discipline (spec/data-model.md "Transitions").
//
// The whole group disables while any one request is in flight — not just the
// clicked button — since set_story_state has no FOR UPDATE lock yet: a
// concurrent Accept/Reject click here could otherwise race the same
// lost-update bug at the UI layer. Server Actions return failures as values
// so production error masking cannot replace the message shown inline.
export function TransitionButtons({
  storyId,
  projectId,
  stateId,
  states,
  storyType,
  points,
  pointScale,
}: {
  storyId: string;
  projectId: string;
  stateId: string | null;
  states: ProjectState[];
  storyType: string;
  points: number | null;
  pointScale: number[];
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(key: string, action: () => Promise<ActionResult>) {
    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.message);
        }
      } catch {
        setError("Failed to update the story");
      } finally {
        setPendingKey(null);
      }
    });
  }

  const gateStates = toGateStates(states);
  const gate = computeStateGate(gateStates, stateId);
  const categoryOf = (id: string): StateCategory | undefined => gateStates.find((s) => s.id === id)?.category;

  const buttons: ButtonSpec[] = [];
  if (gate.kind === "advance") {
    buttons.push({ key: "advance", label: gate.label, targetStateId: gate.targetStateId });
  } else if (gate.kind === "accept-reject") {
    buttons.push({ key: "accept", label: gate.acceptLabel, targetStateId: gate.acceptStateId });
    if (gate.rejectStateId) {
      buttons.push({ key: "reject", label: "Reject", targetStateId: gate.rejectStateId });
    }
  } else if (gate.kind === "restart" && gate.targetStateId) {
    buttons.push({ key: "restart", label: "Restart", targetStateId: gate.targetStateId });
  }

  if (buttons.length === 0) {
    return null;
  }

  // An unestimated feature can't move into a non-unstarted-category state
  // (spec/features.md; mirrors set_story_state's own gate). Pivotal Tracker
  // parity (TASK-37, spec/ux-principles.md principle 1 — no dead controls):
  // instead of a disabled button, show an Estimate trigger with the point
  // scale in a popover whenever every offered target would be blocked (a
  // custom project's unstarted-category-to-unstarted-category button, e.g.
  // a triage step, is NOT blocked — the DB doesn't require an estimate for
  // that). Estimating never auto-advances the story — the normal button
  // appears as the next click once `points` is set.
  const needsEstimate =
    isUnestimatedFeature(storyType, points) &&
    buttons.every((button) => {
      const category = categoryOf(button.targetStateId);
      return category !== undefined && category !== "unstarted";
    });

  if (needsEstimate) {
    return (
      <div className="flex flex-col gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="xs" disabled={isPending}>
              {isPending ? "Estimate…" : "Estimate"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-auto max-w-[calc(100vw-2rem)] flex-wrap gap-1 p-2">
            {pointScale.map((value) => (
              <Button
                key={value}
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Estimate: ${value} point${value === 1 ? "" : "s"}`}
                title={`Estimate: ${value} point${value === 1 ? "" : "s"}`}
                disabled={isPending}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("project_id", projectId);
                  formData.set("story_id", storyId);
                  formData.set("points", String(value));
                  run(`estimate:${value}`, () => estimateStory(formData));
                }}
              >
                {pendingKey === `estimate:${value}` ? "…" : formatPoints(value)}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {buttons.map((button) => (
          <Button
            key={button.key}
            type="button"
            variant="outline"
            size="xs"
            disabled={isPending}
            onClick={() => {
              const formData = new FormData();
              formData.set("project_id", projectId);
              formData.set("story_id", storyId);
              formData.set("state_id", button.targetStateId);
              run(button.key, () => setStoryState(formData));
            }}
          >
            {pendingKey === button.key ? `${button.label}…` : button.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
