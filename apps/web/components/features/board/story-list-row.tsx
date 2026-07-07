"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bug, Star, Wrench, type LucideIcon } from "lucide-react";
import { formatPoints, STORY_STATE_META, STORY_TYPE_META, type StoryState, type StoryType } from "@/lib/utils/stories";
import { initials, ReleaseMarkerRow, type StoryCardData } from "./story-card";
import { TransitionButtons } from "@/components/features/story/transition-buttons";

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
}: {
  story: StoryCardData;
  projectId: string;
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
  const stateMeta = STORY_STATE_META[story.state as StoryState];
  const isAccepted = story.state === "accepted";

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 shadow-xs ${
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
        <span className="truncate text-sm font-medium">{story.title}</span>
      </button>

      {stateMeta && (
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${stateMeta.className}`}>
          {stateMeta.label}
        </span>
      )}
      {story.points != null && (
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {formatPoints(story.points)}
        </span>
      )}
      {story.labels.map((label) => (
        <span
          key={label.id}
          className="hidden shrink-0 rounded px-1.5 py-0.5 text-xs sm:inline"
          style={{ backgroundColor: `${label.color}22`, color: label.color }}
        >
          {label.name}
        </span>
      ))}
      {story.assigneeName && (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-secondary-foreground"
          title={story.assigneeName}
        >
          {initials(story.assigneeName)}
        </span>
      )}
      <div className="shrink-0">
        <TransitionButtons
          storyId={story.id}
          projectId={projectId}
          state={story.state}
          storyType={story.story_type}
          points={story.points}
        />
      </div>
    </div>
  );
}
