"use client";

import Link from "next/link";
import { useState } from "react";
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

// `release` stories render as a milestone marker row (flag + horizontal
// rule) instead of a regular card — see spec/screens.md "Story card UX".
function ReleaseMarkerRow({ story }: { story: StoryCardData }) {
  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex items-center gap-2 py-1 text-sm hover:opacity-80"
    >
      <span title={STORY_TYPE_META.release.label}>{STORY_TYPE_META.release.icon}</span>
      <span className="font-medium">{story.title}</span>
      <span className="h-px flex-1 bg-indigo-300 dark:bg-indigo-700" />
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
      {typeMeta && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${typeMeta.className}`}
          title={typeMeta.label}
        >
          {typeMeta.icon}
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
        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-zinc-800 dark:text-gray-300">
          {formatPoints(story.points)}
        </span>
      )}

      {story.assigneeName && (
        <span className="shrink-0 text-xs text-gray-500">{story.assigneeName}</span>
      )}
    </>
  );

  return (
    <div
      className={`rounded-md border border-gray-200 p-3 dark:border-gray-800 ${
        isAccepted ? "bg-green-50 dark:bg-green-950/40" : "bg-white dark:bg-zinc-900"
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
        <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800">
          {detail ? (
            <StoryDetailPanel detail={detail} onMutated={refreshDetail} />
          ) : (
            <p className="text-sm text-gray-500">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
