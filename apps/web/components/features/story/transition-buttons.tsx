"use client";

import { estimateStory, transitionStory } from "@/app/projects/[id]/board/actions";
import {
  availableTransitions,
  transitionLabel,
  type StoryState as StoryLifecycleState,
} from "@storylane/core";
import { formatPoints, isUnestimatedFeature } from "@/lib/utils/stories";
import { Button } from "@/components/ui/button";

// One-click state-transition buttons (Start / Finish / Deliver / Accept /
// Reject / Restart — see spec/screens.md "Story card UX"). Shared by the
// story card (always visible) and the story detail panel (standalone page +
// board inline expansion), so the transition rules live in one place.
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

  if (actions.length === 0) {
    return null;
  }

  // An unestimated feature can't Start/Restart (spec/features.md). Pivotal
  // Tracker parity (TASK-37, spec/ux-principles.md principle 1 — no dead
  // controls): instead of a disabled button, show the point-scale estimation
  // buttons in its place. Both states this can happen in (`unstarted`,
  // `rejected`) offer exactly one transition action, so replacing the whole
  // group is equivalent to replacing just that button. Estimating never
  // auto-starts the story — Start/Restart appears as the next click once
  // `points` is set.
  if (isUnestimatedFeature(storyType, points)) {
    return (
      <form action={estimateStory} className="flex flex-wrap items-center gap-1">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="story_id" value={storyId} />
        {pointScale.map((value) => (
          <Button
            key={value}
            type="submit"
            name="points"
            value={value}
            variant="outline"
            size="xs"
            aria-label={`Estimate: ${value} point${value === 1 ? "" : "s"}`}
            title={`Estimate: ${value} point${value === 1 ? "" : "s"}`}
          >
            {formatPoints(value)}
          </Button>
        ))}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {actions.map((action) => (
        <form key={action} action={transitionStory}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="story_id" value={storyId} />
          <input type="hidden" name="action" value={action} />
          <Button type="submit" variant="outline" size="xs">
            {transitionLabel(action)}
          </Button>
        </form>
      ))}
    </div>
  );
}
