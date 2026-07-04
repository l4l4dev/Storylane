"use client";

import { transitionStory } from "@/app/projects/[id]/board/actions";
import {
  applyTransition,
  availableTransitions,
  transitionLabel,
  type StoryState as StoryLifecycleState,
} from "@/lib/utils/story-state";
import { isUnestimatedFeature } from "@/lib/utils/stories";

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
}: {
  storyId: string;
  projectId: string;
  state: string;
  storyType: string;
  points: number | null;
}) {
  const actions = availableTransitions(state as StoryLifecycleState);

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {actions.map((action) => {
        // An unestimated feature cannot be started (spec/features.md) — the
        // button targeting `started` (Start / Restart) is disabled.
        const blocked =
          isUnestimatedFeature(storyType, points) &&
          applyTransition(state as StoryLifecycleState, action) === "started";
        return (
          <form key={action} action={transitionStory}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="story_id" value={storyId} />
            <input type="hidden" name="action" value={action} />
            <button
              type="submit"
              disabled={blocked}
              title={blocked ? "Estimate this feature before starting" : undefined}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-700 dark:hover:bg-zinc-800"
            >
              {transitionLabel(action)}
            </button>
          </form>
        );
      })}
    </div>
  );
}
