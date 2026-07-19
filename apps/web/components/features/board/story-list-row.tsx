"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bug, Star, Wrench, type LucideIcon } from "lucide-react";
import { formatPoints, storyStateBadge, STORY_TYPE_META, type StoryType } from "@/lib/utils/stories";
import { initials } from "@/lib/utils/format";
import type { ProjectState } from "@/lib/types";
import { EpicBadge, ReleaseMarkerRow, type StoryCardData } from "./story-card";
import { TransitionButtons } from "@/components/features/story/transition-buttons";
import { AgentIndicator } from "@/components/features/projects/agent-indicator";

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
  insertMenu,
}: {
  // StoryCardData plus state_id — the row needs it for the badge and
  // transition buttons; the physical card (isDone only) doesn't.
  story: StoryCardData & { state_id: string | null };
  projectId: string;
  states: ProjectState[];
  pointScale: number[];
  // Row-level "insert note/iteration break here" menu (TASK-42) — Backlog
  // rows pass this; Current/Icebox rows (no notes/breaks there) don't.
  insertMenu?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openPeek() {
    const params = new URLSearchParams(searchParams);
    params.set("story", story.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (story.story_type === "release") {
    return <ReleaseMarkerRow story={story} onOpen={openPeek} />;
  }

  const typeMeta = STORY_TYPE_META[story.story_type as StoryType];
  const TypeIcon = STORY_TYPE_ICON[story.story_type as Exclude<StoryType, "release">];
  const stateBadge = storyStateBadge(story.state_id, states);
  const isAccepted = story.isDone;

  return (
    <div
      data-testid="story-list-row"
      className={`flex w-full min-w-0 max-w-full items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 shadow-xs ${
        isAccepted ? "bg-green-50 dark:bg-green-950/40" : "bg-card"
      }`}
    >
      <button
        type="button"
        onClick={openPeek}
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

      {story.epic && (
        <span className="hidden min-w-0 sm:inline-flex">
          <EpicBadge epic={story.epic} />
        </span>
      )}
      {/* No badge for Icebox rows — the column/section itself already says
          "Icebox", so a per-row badge there would be redundant noise. */}
      {story.state_id !== null && (
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${stateBadge.className}`}>
          {stateBadge.label}
        </span>
      )}
      {story.points != null && (
        <span className="hidden shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground sm:inline">
          {formatPoints(story.points)}
        </span>
      )}
      {story.labels.map((label) => (
        <span
          key={label.id}
          className="hidden shrink-0 rounded px-1.5 py-0.5 text-xs text-foreground sm:inline"
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
      <div className="shrink-0">
        <TransitionButtons
          storyId={story.id}
          projectId={projectId}
          stateId={story.state_id}
          states={states}
          storyType={story.story_type}
          points={story.points}
          pointScale={pointScale}
        />
      </div>
      {insertMenu}
    </div>
  );
}
