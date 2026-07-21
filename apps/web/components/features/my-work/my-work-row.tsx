"use client";

import { useState } from "react";
import Link from "next/link";
import { Bug, Pin, Star, Wrench, type LucideIcon } from "lucide-react";
import { togglePin } from "@/app/stories/[id]/actions";
import { formatPoints, STORY_TYPE_META, type StoryType } from "@/lib/utils/stories";
import { projectAccentClass } from "@/lib/utils/project-color";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORY_TYPE_ICON: Record<Exclude<StoryType, "release">, LucideIcon> = {
  feature: Star,
  bug: Bug,
  chore: Wrench,
};

export type MyWorkRowData = {
  id: string;
  number: number;
  title: string;
  storyType: string;
  points: number | null;
  projectId: string;
  projectName: string;
  stateBadge: { label: string; className: string };
  pinned: boolean;
};

// A My Work row (Today or a project group under Assigned): a compact,
// cross-project version of the board's StoryListRow — always shows its
// project so the row still makes sense outside that project's own board.
// Read-only otherwise (no drag, no inline transition buttons): My Work
// parity, priority lives on each project's own board.
export function MyWorkRow({ story }: { story: MyWorkRowData }) {
  const [pinned, setPinned] = useState(story.pinned);
  const [pending, setPending] = useState(false);
  // A failed pin/unpin reverts optimistically AND says so — a silent revert
  // reads as "nothing happened" (spec/ux-principles.md principle 2: every
  // action produces visible feedback), the same failure this repo's
  // MutationErrorBanner/story-detail-panel error text already guard against
  // elsewhere; My Work's per-row list gets the lighter inline form.
  const [error, setError] = useState<string | null>(null);
  const typeMeta = STORY_TYPE_META[story.storyType as StoryType];
  const TypeIcon = STORY_TYPE_ICON[story.storyType as Exclude<StoryType, "release">];

  async function handleTogglePin() {
    const next = !pinned;
    setPinned(next);
    setError(null);
    setPending(true);
    const result = await togglePin(story.id, next);
    if (!result.ok) {
      setPinned(!next);
      setError(result.message);
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        data-testid="my-work-row"
        // Per-project accent (TASK-108, doc-12): the left border is coloured
        // per project (projectAccentClass sets --project-accent) so rows from
        // different projects read apart at a glance, not just personal-vs-team.
        className={cn(
          "flex w-full min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-xs",
          "border-l-2 border-l-[color:var(--project-accent)]",
          projectAccentClass(story.projectId),
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={pinned ? "Unpin from My Work" : "Pin to My Work"}
          aria-pressed={pinned}
          disabled={pending}
          onClick={() => void handleTogglePin()}
          className="shrink-0"
        >
          <Pin className={pinned ? "fill-current" : undefined} />
        </Button>

        <Link
          href={`/stories/${story.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          {typeMeta && TypeIcon && (
            <span className={`inline-flex shrink-0 items-center rounded p-1 ${typeMeta.className}`} title={typeMeta.label}>
              <TypeIcon className="h-3.5 w-3.5" aria-label={typeMeta.label} />
            </span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">#{story.number}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{story.title}</span>
        </Link>

        <Badge
          variant="outline"
          // Per-project accent on the BORDER only (doc-12 "ラベルの色も"): the
          // border tints the chip per project, but the label text stays
          // text-foreground — the raw accent hue as text fails WCAG 4.5:1 on
          // the card for several palette slots (fable-advisor). Same rule
          // applies wherever this accent is reused (see project-color.ts).
          className="hidden max-w-28 shrink-0 truncate border-[color:var(--project-accent)] sm:inline-flex"
          title={story.projectName}
        >
          {story.projectName}
        </Badge>
        <Badge className={cn("max-w-24 shrink-0 truncate sm:max-w-32", story.stateBadge.className)} title={story.stateBadge.label}>
          {story.stateBadge.label}
        </Badge>
        {story.points != null && (
          <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex" aria-label={`${story.points} points`}>
            {formatPoints(story.points)}
          </Badge>
        )}
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="px-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
