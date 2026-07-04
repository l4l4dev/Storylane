"use client";

import Link from "next/link";
import { useState } from "react";
import { Bug, Flag, Star, Wrench, type LucideIcon } from "lucide-react";
import { getStoryDetail, type StoryDetail } from "@/app/stories/[id]/actions";
import { StoryDetailPanel } from "@/components/features/story/story-detail-panel";
import { TransitionButtons } from "@/components/features/story/transition-buttons";
import {
  formatPoints,
  STORY_STATE_META,
  STORY_TYPE_META,
  type StoryState,
  type StoryType,
} from "@/lib/utils/stories";

export type StoryCardData = {
  id: string;
  title: string;
  story_type: string;
  state: string;
  points: number | null;
  assigneeName: string | null;
  labels: { id: string; name: string; color: string }[];
};

// Story-type glyphs live here (client) rather than in the framework-free
// stories.ts data module, keeping that util React-free (see its header note).
const STORY_TYPE_ICON: Record<StoryType, LucideIcon> = {
  feature: Star,
  bug: Bug,
  chore: Wrench,
  release: Flag,
};

// `release` stories render as a milestone marker row (flag + horizontal
// rule) instead of a regular card — see spec/screens.md "Story card UX".
function ReleaseMarkerRow({ story }: { story: StoryCardData }) {
  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex items-center gap-2 py-1 text-sm hover:opacity-80"
    >
      <Flag
        className="h-4 w-4 shrink-0 text-primary"
        aria-label={STORY_TYPE_META.release.label}
      />
      <span className="font-medium">{story.title}</span>
      <span className="h-px flex-1 bg-primary/30" />
    </Link>
  );
}

// `projectId` is optional because the project home page (spec/screens.md:
// "backlog + current iteration, read-only summary") renders cards without
// the one-click transition buttons — omitting it suppresses them and keeps
// the card a plain link to the standalone detail page rather than an inline
// expansion trigger.
export function StoryCard({
  story,
  projectId,
}: {
  story: StoryCardData;
  projectId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<StoryDetail | null>(null);

  if (story.story_type === "release") {
    return <ReleaseMarkerRow story={story} />;
  }

  const typeMeta = STORY_TYPE_META[story.story_type as StoryType];
  const TypeIcon = STORY_TYPE_ICON[story.story_type as StoryType];
  const stateMeta = STORY_STATE_META[story.state as StoryState];
  const isAccepted = story.state === "accepted";

  async function refreshDetail() {
    const fresh = await getStoryDetail(story.id);
    setDetail(fresh);
  }

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      void refreshDetail();
    }
  }

  const headerContent = (
    <>
      {typeMeta && TypeIcon && (
        <span
          className={`inline-flex shrink-0 items-center rounded px-1.5 py-1 ${typeMeta.className}`}
          title={typeMeta.label}
        >
          <TypeIcon className="h-3.5 w-3.5" aria-label={typeMeta.label} />
        </span>
      )}

      <span className="flex-1 truncate text-sm">{story.title}</span>

      {story.labels.map((label) => (
        <span
          key={label.id}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs"
          style={{ backgroundColor: `${label.color}22`, color: label.color }}
        >
          {label.name}
        </span>
      ))}

      {stateMeta && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${stateMeta.className}`}>
          {stateMeta.label}
        </span>
      )}

      {story.points != null && (
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {formatPoints(story.points)}
        </span>
      )}

      {story.assigneeName && (
        <span className="shrink-0 text-xs text-muted-foreground">{story.assigneeName}</span>
      )}
    </>
  );

  return (
    <div
      className={`rounded-md border border-border p-3 ${
        isAccepted ? "bg-green-50 dark:bg-green-950/40" : "bg-card"
      }`}
    >
      {/* Clicking a story card expands its detail inline within the panel
          (accordion) instead of navigating — see spec/screens.md "Board
          layout". `/stories/[id]` remains a standalone page for deep links,
          so cards without a `projectId` (the read-only project home summary)
          keep the old link-to-full-page behavior instead. */}
      {projectId ? (
        <button
          type="button"
          onClick={handleToggle}
          className="flex w-full items-center gap-3 text-left hover:opacity-80"
        >
          {headerContent}
        </button>
      ) : (
        <Link href={`/stories/${story.id}`} className="flex items-center gap-3 hover:opacity-80">
          {headerContent}
        </Link>
      )}

      {projectId && !expanded && (
        <div className="mt-2">
          <TransitionButtons
            storyId={story.id}
            projectId={projectId}
            state={story.state}
            storyType={story.story_type}
            points={story.points}
          />
        </div>
      )}

      {projectId && expanded && (
        <div className="mt-3 border-t border-border pt-3">
          {detail ? (
            <StoryDetailPanel detail={detail} onMutated={refreshDetail} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
