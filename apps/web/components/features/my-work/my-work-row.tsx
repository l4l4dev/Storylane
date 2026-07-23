"use client";

import Link from "next/link";
import { Bug, CircleCheckBig, Star, User, Wrench, type LucideIcon } from "lucide-react";
import { formatDate } from "@/lib/utils/format";
import { formatPoints, STORY_TYPE_META, type StoryType } from "@/lib/utils/stories";
import { projectAccentClass } from "@/lib/utils/project-color";
import { Badge } from "@/components/ui/badge";
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
  // Governs whether a drag can complete the card in Done (setMyWorkColumn) —
  // surfaced on the card itself so that behavior difference is visible, not
  // just discoverable by trying to drag it (doc-17 #3).
  isPersonal: boolean;
  stateBadge: { label: string; className: string };
};

// A My Work card (TASK-174): a compact, cross-project version of the board's
// StoryCard (story-card.tsx) — same two-tier shape (title row, then a meta
// row of badges) so identity/state read the same way in both places, plus a
// project badge and a left-border accent the board card doesn't need (board
// cards live inside one project's column; My Work spans projects). This
// component itself is a plain render; the drag affordance (TASK-132) is
// added by MyWorkSections wrapping it in SortableItem.
//
// The meta row never hides anything below `sm` (doc-17 #2's consensus:
// identity must stay visible, not just be reformatted away) — it wraps
// instead, which is also what makes the project-identity chip and the
// completion marker never collide with the title regardless of width
// (the doc-17-adjacent bug this task fixes: the old single-line row's
// trailing badges overlapped once the row got too crowded to fit them).
//
// `completedAt` is set only for a Done-column card (fable-advisor TASK-132):
// Done is an additive log (lib/utils/my-work.ts classifyMyWork), so the SAME
// story can render simultaneously as a live Doing card (no completedAt) and a
// Done log entry (completedAt set) — the state badge alone (which always
// reflects the CURRENT real state, live-joined) can't tell those apart, so a
// completion marker is required to distinguish "this is a log entry" from
// "this is the live card" at a glance (ux-principles.md principle 9). It sits
// in the meta row (pushed to the far end via ml-auto, like the board card's
// assignee slot), not the title row — a title row that wraps to multiple
// lines has no stable place to anchor a shrink-0 sibling.
export function MyWorkRow({
  story,
  completedAt,
  onOpen,
}: {
  story: MyWorkRowData;
  completedAt?: string;
  // The main My Work board passes this to open the story in a side peek
  // (TASK-172), matching the project board's StoryCard. Left unset by the
  // Done archive page (app/my-work/archive/page.tsx), which has no board
  // underneath to peek over, so it keeps the plain full-page link.
  onOpen?: () => void;
}) {
  const typeMeta = STORY_TYPE_META[story.storyType as StoryType];
  const TypeIcon = STORY_TYPE_ICON[story.storyType as Exclude<StoryType, "release">];
  // The whole card is the click target, title AND meta row, matching the
  // board's StoryCard (its cardContent wraps both tiers in one button/Link
  // too) — fable-advisor caught an initial version that only wrapped the
  // title, silently shrinking the hit target vs. the pre-redesign row (which
  // had the number/Personal tag inside the link) and vs. the board it's
  // meant to match.
  const cardContent = (
    <>
      <div className="flex min-w-0 items-start gap-2">
        {typeMeta && TypeIcon && (
          <span
            className={`mt-0.5 inline-flex shrink-0 items-center rounded p-1 ${typeMeta.className}`}
            title={typeMeta.label}
          >
            <TypeIcon className="h-3.5 w-3.5" aria-label={typeMeta.label} />
          </span>
        )}
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{story.title}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted-foreground">#{story.number}</span>
        {story.isPersonal && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="Personal project — completes only here, in My Work"
          >
            <User className="h-3 w-3" aria-hidden />
            Personal
          </span>
        )}
        <Badge variant="outline" className="max-w-32 shrink-0 truncate" title={story.projectName}>
          {story.projectName}
        </Badge>
        <Badge className={cn("max-w-32 shrink-0 truncate", story.stateBadge.className)} title={story.stateBadge.label}>
          {story.stateBadge.label}
        </Badge>
        {story.points != null && (
          <Badge variant="secondary" className="shrink-0" aria-label={`${story.points} points`}>
            {formatPoints(story.points)}
          </Badge>
        )}
        {completedAt && (
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
            title={`Completed ${formatDate(completedAt)}`}
          >
            <CircleCheckBig className="h-3 w-3 text-success" aria-hidden />
            Completed
          </span>
        )}
      </div>
    </>
  );

  // Per-project accent (TASK-108, doc-12): the left border is coloured per
  // project (projectAccentClass sets --project-accent) so cards from
  // different projects read apart at a glance. This is the ONLY color
  // encoding of project identity (doc-17 #18: the project badge used to also
  // carry an accent-tinted border — redundant with this).
  const cardClassName = cn(
    "block w-full rounded-lg border border-border bg-card p-3 text-left shadow-xs hover:opacity-80",
    "border-l-2 border-l-[color:var(--project-accent)]",
    projectAccentClass(story.projectId),
  );

  return onOpen ? (
    <button type="button" data-testid="my-work-row" onClick={onOpen} className={cardClassName}>
      {cardContent}
    </button>
  ) : (
    <Link href={`/stories/${story.id}`} data-testid="my-work-row" className={cardClassName}>
      {cardContent}
    </Link>
  );
}
