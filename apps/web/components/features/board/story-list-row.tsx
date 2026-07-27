"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Bug, Star, Wrench, type LucideIcon } from "lucide-react";
import { formatPoints, storyStateBadge, STORY_TYPE_META, type StoryType } from "@/lib/utils/stories";
import { initials } from "@/lib/utils/format";
import { DEFAULT_EPIC_COLOR } from "@/lib/utils/epics-list";
import type { ProjectState } from "@/lib/types";
import { ReleaseMarkerRow, type StoryCardData } from "./story-card";
import { TransitionButtons } from "@/components/features/story/transition-buttons";
import { AgentIndicator } from "@/components/features/projects/agent-indicator";
import { Badge } from "@/components/ui/badge";
import { useOpenPeek } from "./use-open-peek";
import { StoryEpicMenu } from "./story-epic-menu";

const STORY_TYPE_ICON: Record<Exclude<StoryType, "release">, LucideIcon> = {
  feature: Star,
  bug: Bug,
  chore: Wrench,
};

// Compact, horizontal row for the List view (see spec/screens.md "Board
// layout: List view" — Pivotal Tracker parity). Unlike `StoryCard`, state is
// shown as a badge rather than a physical column, and one-click transition
// buttons are always visible since there's no column to drop onto.
export function StoryListRow({
  story,
  projectId,
  states,
  pointScale,
  doneDefinition,
  insertMenu,
  onError,
}: {
  // StoryCardData plus state_id — the row needs it for the badge and
  // transition buttons; the physical card (isDone only) doesn't. parentId/
  // parentEpicTitle/parentEpicColor: this row renders in its own zone even
  // when it's a container's child (the Epics band shows a separate, lighter
  // mirror row — doc-20 §3) — the link and left rule keep the relation
  // visible here too (ux-principles principle 8: never make a membership
  // invisible).
  story: StoryCardData & {
    state_id: string | null;
    parentId: string | null;
    parentEpicTitle: string | null;
    parentEpicColor: string | null;
  };
  projectId: string;
  states: ProjectState[];
  pointScale: number[];
  // TASK-206: project's Definition of Done, passed straight through to
  // TransitionButtons. Null/undefined = no DoD set, nothing extra renders.
  doneDefinition?: string | null;
  // Row-level "insert note/iteration break here" menu (TASK-42) — Backlog
  // rows pass this; Current/Icebox rows (no notes/breaks there) don't.
  insertMenu?: ReactNode;
  // Surfaces a failed "Remove from epic" in the caller's own error slot —
  // the List view has one banner for the whole view, not one per row.
  onError?: (message: string) => void;
}) {
  const openPeek = useOpenPeek();

  if (story.story_type === "release") {
    return <ReleaseMarkerRow story={story} onOpen={() => openPeek(story.id)} />;
  }

  const typeMeta = STORY_TYPE_META[story.story_type as StoryType];
  const TypeIcon = STORY_TYPE_ICON[story.story_type as Exclude<StoryType, "release">];
  const stateBadge = storyStateBadge(story.state_id, states);
  const isAccepted = story.isDone;
  const hasEpic = story.parentId !== null && story.parentEpicTitle !== null;

  return (
    <div
      data-testid="story-list-row"
      className={`flex w-full min-w-0 max-w-full flex-col gap-1 rounded-lg border border-border px-2.5 py-1.5 shadow-xs ${
        hasEpic ? "border-l-2" : ""
      } ${isAccepted ? "bg-green-50 dark:bg-green-950/40" : "bg-card"}`}
      style={hasEpic ? { borderLeftColor: story.parentEpicColor ?? DEFAULT_EPIC_COLOR } : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => openPeek(story.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          {typeMeta && TypeIcon && (
            <span className={`inline-flex shrink-0 items-center rounded p-1 ${typeMeta.className}`} title={typeMeta.label}>
              <TypeIcon className="h-3.5 w-3.5" aria-label={typeMeta.label} />
            </span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">#{story.number}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{story.title}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <TransitionButtons
            storyId={story.id}
            projectId={projectId}
            stateId={story.state_id}
            states={states}
            storyType={story.story_type}
            points={story.points}
            pointScale={pointScale}
            doneDefinition={doneDefinition}
          />
          {hasEpic && (
            <StoryEpicMenu
              storyId={story.id}
              projectId={projectId}
              epicTitle={story.parentEpicTitle as string}
              onError={onError}
            />
          )}
          {insertMenu}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {hasEpic && (
          <Link
            href={`/stories/${story.parentId}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:underline"
            title={`Part of epic: ${story.parentEpicTitle}`}
          >
            {story.parentEpicTitle}
          </Link>
        )}
        {/* No badge for Icebox rows — the column/section itself already says
            "Icebox", so a per-row badge there would be redundant noise. */}
        {story.state_id !== null && (
          <Badge className={`max-w-24 truncate sm:max-w-32 ${stateBadge.className}`} title={stateBadge.label}>
            {stateBadge.label}
          </Badge>
        )}
        {story.points != null && (
          <Badge variant="secondary" aria-label={`${story.points} points`}>
            {formatPoints(story.points)}
          </Badge>
        )}
        {story.labels.map((label) => (
          <span
            key={label.id}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-foreground"
            style={{ backgroundColor: `${label.color}22` }}
          >
            {label.name}
          </span>
        ))}
        {story.assigneeName && (
          <span
            className={`flex h-5 shrink-0 items-center bg-secondary text-[10px] font-medium text-secondary-foreground ${
              story.assigneeIsAgent ? "gap-1 rounded px-1.5" : "w-5 justify-center rounded-full"
            }`}
            title={`${story.assigneeName}${story.assigneeIsAgent ? " (agent)" : ""}`}
          >
            {initials(story.assigneeName)}
            {story.assigneeIsAgent && <AgentIndicator compact />}
          </span>
        )}
      </div>
    </div>
  );
}
