"use client";

import { formatPoints } from "@/lib/utils/stories";
import { useOpenPeek } from "@/components/features/board/use-open-peek";
import type { BandChildLocation, EpicBandChild } from "@/lib/utils/epics-list";

const BAND_LOCATION_LABEL: Record<BandChildLocation, string> = {
  current: "Current",
  backlog: "Backlog",
  icebox: "Icebox",
  done: "Done",
  rejected: "Rejected",
};

// rose for rejected matches its color everywhere else in the app (lib/utils/
// stories.ts, kanban-columns-board.tsx) — kept distinct from done's green so
// a bounced story never reads as finished at a glance (ux-principles
// principle 9: lists distinguish live from dormant, never interleaved).
const BAND_LOCATION_DOT_CLASS: Record<BandChildLocation, string> = {
  current: "bg-blue-500",
  backlog: "bg-amber-500",
  icebox: "bg-sky-500",
  done: "bg-green-500",
  rejected: "bg-rose-500",
};

// A container's child, shown as a light row (doc-20 §3/§6): a location dot +
// #number + title + points. Shared by the List view's Epics band, /epics'
// right pane, and a container's own "Child stories" detail section (AC#4) —
// one component so the three surfaces can't drift apart. Not a drag source
// and renders no drag handle (ux-principles principle 1): the real row, in
// its own zone, is what the user drags — this row exists only so scheduling
// a child doesn't make it disappear from its epic's view (owner defect 3).
export function EpicChildRow({ child }: { child: EpicBandChild }) {
  const openPeek = useOpenPeek();

  return (
    <li>
      <button
        type="button"
        onClick={() => openPeek(child.id)}
        title={`${BAND_LOCATION_LABEL[child.location]} #${child.number}`}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
      >
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${BAND_LOCATION_DOT_CLASS[child.location]}`} />
        <span className="shrink-0 text-muted-foreground">#{child.number}</span>
        <span className="min-w-0 flex-1 truncate">{child.title}</span>
        {child.points != null && <span className="shrink-0 text-muted-foreground">{formatPoints(child.points)}</span>}
      </button>
    </li>
  );
}
