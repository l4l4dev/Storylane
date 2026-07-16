"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bug, Flag, Star, Wrench, type LucideIcon } from "lucide-react";
import {
  formatPoints,
  STORY_TYPE_META,
  type StoryType,
} from "@/lib/utils/stories";
import { initials } from "@/lib/utils/format";

export type StoryCardData = {
  id: string;
  // Per-project sequential story number — shown as #123 (see spec/integrations.md).
  number: number;
  title: string;
  description: string | null;
  story_type: string;
  state: string;
  points: number | null;
  assigneeName: string | null;
  labels: { id: string; name: string; color: string }[];
  // TASK-41: which epic (if any) this story belongs to — kept visible on
  // List/Kanban/Focus cards so promoting a story out of the backlog doesn't
  // make its epic membership invisible (spec/ux-principles.md principle 8).
  epic: { id: string; name: string; color: string } | null;
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
// Exported so the List view's compact row can reuse the same treatment.
export function ReleaseMarkerRow({ story, onOpen }: { story: StoryCardData; onOpen?: () => void }) {
  const content = (
    <>
      <Flag
        className="h-4 w-4 shrink-0 text-primary"
        aria-label={STORY_TYPE_META.release.label}
      />
      <span className="font-medium">{story.title}</span>
      <span className="h-px flex-1 bg-primary/30" />
    </>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 py-1 text-left text-sm hover:opacity-80"
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex items-center gap-2 py-1 text-sm hover:opacity-80"
    >
      {content}
    </Link>
  );
}

// Epic badge (TASK-41): a colored dot (matching the Epics panel/page's own
// dot-plus-name treatment) plus the epic's name, distinguishing it from the
// plain label pills next to it. Exported so the List view's row can render
// the same badge.
export function EpicBadge({ epic }: { epic: { id: string; name: string; color: string } }) {
  return (
    <span
      className="inline-flex max-w-40 min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs"
      style={{ backgroundColor: `${epic.color}22`, color: epic.color }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: epic.color }} />
      <span className="truncate">{epic.name}</span>
    </span>
  );
}

// Initials for the assignee avatar chip: first letter of the first two words
// ("Mary Evans" -> "ME"), or the first two characters of a single-word name.
// Exported so the List view's compact row can reuse the same treatment.
// Multica-style story card (spec/screens.md "Story card UX"): type icon,
// title, one-line description, then a meta row of points / labels / assignee.
// State transitions happen by dragging between columns — no buttons here.
// On the board (`projectId` given) a click opens the side peek by setting
// `?story=<id>`; elsewhere the card links to the standalone `/stories/[id]`.
export function StoryCard({
  story,
  projectId,
}: {
  story: StoryCardData;
  projectId?: string;
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
    return <ReleaseMarkerRow story={story} onOpen={projectId ? openPeek : undefined} />;
  }

  const typeMeta = STORY_TYPE_META[story.story_type as StoryType];
  const TypeIcon = STORY_TYPE_ICON[story.story_type as StoryType];
  const isAccepted = story.state === "accepted";

  const cardContent = (
    <>
      <div className="flex items-start gap-2">
        {typeMeta && TypeIcon && (
          <span
            className={`mt-0.5 inline-flex shrink-0 items-center rounded p-1 ${typeMeta.className}`}
            title={typeMeta.label}
          >
            <TypeIcon className="h-3.5 w-3.5" aria-label={typeMeta.label} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug">{story.title}</span>
          {story.description && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {story.description}
            </span>
          )}
        </span>
      </div>

      {/* The number always renders, so the meta row is unconditional. */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted-foreground">#{story.number}</span>
        {story.points != null && (
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {formatPoints(story.points)}
          </span>
        )}
        {story.epic && <EpicBadge epic={story.epic} />}
        {story.labels.map((label) => (
          <span
            key={label.id}
            className="min-w-0 truncate rounded px-1.5 py-0.5 text-xs"
            style={{ backgroundColor: `${label.color}22`, color: label.color }}
          >
            {label.name}
          </span>
        ))}
        {story.assigneeName && (
          <span
            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-secondary-foreground"
            title={story.assigneeName}
          >
            {initials(story.assigneeName)}
          </span>
        )}
      </div>
    </>
  );

  return (
    <div
      className={`rounded-lg border border-border p-3 shadow-xs ${
        isAccepted ? "bg-green-50 dark:bg-green-950/40" : "bg-card"
      }`}
    >
      {projectId ? (
        <button type="button" onClick={openPeek} className="block w-full text-left hover:opacity-80">
          {cardContent}
        </button>
      ) : (
        <Link href={`/stories/${story.id}`} className="block hover:opacity-80">
          {cardContent}
        </Link>
      )}
    </div>
  );
}
