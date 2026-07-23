"use client";

import Link from "next/link";
import { Bug, CircleCheckBig, Star, User, Wrench, type LucideIcon } from "lucide-react";
import { formatDate, initials } from "@/lib/utils/format";
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

// A My Work row: a compact, cross-project version of the board's StoryListRow
// — always shows its project so the row still makes sense outside that
// project's own board. This component itself is a plain render; the drag
// affordance (TASK-132) is added by MyWorkSections wrapping it in SortableItem.
//
// `completedAt` is set only for a Done-column card (fable-advisor TASK-132):
// Done is an additive log (lib/utils/my-work.ts classifyMyWork), so the SAME
// story can render simultaneously as a live Doing card (no completedAt) and a
// Done log entry (completedAt set) — the state badge alone (which always
// reflects the CURRENT real state, live-joined) can't tell those apart, so a
// completion marker is required to distinguish "this is a log entry" from
// "this is the live card" at a glance (ux-principles.md principle 9).
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
  const titleRowClassName = "flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80";
  const titleRowContent = (
    <>
      {typeMeta && TypeIcon && (
        <span className={`inline-flex shrink-0 items-center rounded p-1 ${typeMeta.className}`} title={typeMeta.label}>
          <TypeIcon className="h-3.5 w-3.5" aria-label={typeMeta.label} />
        </span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">#{story.number}</span>
      {story.isPersonal && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
          title="Personal project — completes only here, in My Work"
        >
          <User className="h-3 w-3" aria-hidden />
          {/* Icon stays persistent at every width (doc-17 #3); the label
              only joins it at sm+ so it doesn't crowd out the title on
              narrow rows. */}
          <span className="hidden sm:inline">Personal</span>
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{story.title}</span>
    </>
  );

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
        {completedAt && (
          // Strengthened toward reading as history, not a duplicate (owner
          // decision, doc-17 #12/Norman-Krug direction): visible "Completed"
          // text, not just an icon a hover title explains. The same story can
          // render here AND as a live card elsewhere (Done is an additive
          // log) — this is what tells them apart at a glance. The full date
          // lives in the title (fable-advisor review): every Done/archive row
          // already sits under a date group heading, so repeating it inline
          // per row is redundant and, in Done's narrow column, crowds out the
          // title — this is metadata, not a second chip competing for width.
          <span
            className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
            title={`Completed ${formatDate(completedAt)}`}
          >
            <CircleCheckBig className="h-3 w-3 text-success" aria-hidden />
            Completed
          </span>
        )}
        {onOpen ? (
          <button type="button" onClick={onOpen} className={titleRowClassName}>
            {titleRowContent}
          </button>
        ) : (
          <Link href={`/stories/${story.id}`} className={titleRowClassName}>
            {titleRowContent}
          </Link>
        )}

        {/* Below sm the full-name badge (right after this) hides — this
            compact initials marker keeps project identity visible at every
            width instead of losing it entirely (doc-17 #2). Neutral border
            (not the project accent) since the letters already carry identity
            here and the row's left border already carries the accent hue —
            a third encoding of the same thing would be redundant. */}
        <span
          role="img"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold text-foreground sm:hidden"
          title={story.projectName}
          aria-label={story.projectName}
        >
          {initials(story.projectName)}
        </span>
        <Badge
          variant="outline"
          // Per-project accent on the BORDER only (doc-12 "ラベルの色も"): the
          // border tints the chip per project, but the label text stays
          // text-foreground — the raw accent hue as text fails WCAG 4.5:1 on
          // the card for several palette slots. Same rule applies wherever
          // this accent is reused (see project-color.ts).
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
    </div>
  );
}
