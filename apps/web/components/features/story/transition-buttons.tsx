"use client";

import { useState, useTransition } from "react";
import { estimateStory, transitionStory } from "@/app/projects/[id]/board/actions";
import {
  availableTransitions,
  transitionLabel,
  type StoryState as StoryLifecycleState,
} from "@storylane/core";
import { formatPoints, isUnestimatedFeature } from "@/lib/utils/stories";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// One-click state-transition buttons (Start / Finish / Deliver / Accept /
// Reject / Restart — see spec/screens.md "Story card UX"). Shared by the
// story card (always visible) and the story detail panel (standalone page +
// board inline expansion), so the transition rules live in one place.
//
// A plain `<form action={...}>` used to back these — no pending state (a
// double-click could double-submit) and a thrown error (e.g. the everyday
// race where another user already transitioned the story) crashed into the
// route error boundary, replacing the whole board (fable-advisor review
// 2026-07-17, TASK-74). The whole group now disables while any one request
// is in flight — not just the clicked button — since transition_story has no
// FOR UPDATE lock yet (TASK-48 AC#5): a concurrent Accept/Reject click here
// could otherwise race the same lost-update bug at the UI layer. A failure
// shows inline instead of throwing.
export function TransitionButtons({
  storyId,
  projectId,
  state,
  storyType,
  points,
  pointScale,
}: {
  storyId: string;
  projectId: string;
  state: string;
  storyType: string;
  points: number | null;
  pointScale: number[];
}) {
  const actions = availableTransitions(state as StoryLifecycleState);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(key: string, action: () => Promise<void>) {
    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update the story");
      } finally {
        setPendingKey(null);
      }
    });
  }

  if (actions.length === 0) {
    return null;
  }

  // An unestimated feature can't Start/Restart (spec/features.md). Pivotal
  // Tracker parity (TASK-37, spec/ux-principles.md principle 1 — no dead
  // controls): instead of a disabled button, show an Estimate trigger with
  // the point scale in a popover. Both states this can happen in (`unstarted`,
  // `rejected`) offer exactly one transition action, so replacing the whole
  // group is equivalent to replacing just that button. Estimating never
  // auto-starts the story — Start/Restart appears as the next click once
  // `points` is set.
  if (isUnestimatedFeature(storyType, points)) {
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
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant="outline"
            size="xs"
            disabled={isPending}
            onClick={() => {
              const formData = new FormData();
              formData.set("project_id", projectId);
              formData.set("story_id", storyId);
              formData.set("action", action);
              run(action, () => transitionStory(formData));
            }}
          >
            {pendingKey === action ? `${transitionLabel(action)}…` : transitionLabel(action)}
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
