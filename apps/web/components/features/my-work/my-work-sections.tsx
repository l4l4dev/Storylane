"use client";

import { useMemo, useState } from "react";
import {
  buildMyWorkSections,
  groupDoneByDate,
  type MyWorkProject,
  type MyWorkStory,
} from "@/lib/utils/my-work";
import { addDays } from "@storylane/core";
import { formatDate, utcTodayKey } from "@/lib/utils/format";
import { MyWorkRow, type MyWorkRowData } from "./my-work-row";

// A story the client component needs both to classify (MyWorkStory fields)
// and to render (its MyWorkRowData). Server-shaped so the split can re-run
// client-side when the "only current iteration" toggle flips.
export type MyWorkActiveItem = MyWorkStory & { row: MyWorkRowData };
export type MyWorkDoneItem = { completedAt: string; row: MyWorkRowData };

function doneDateLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === addDays(todayKey, -1)) return "Yesterday";
  return formatDate(dateKey);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

// My Work's four sections (doc-12 Thread A). Render order is Todo, Today,
// Doing, Done — Todo is the personal backlog, you move things into Today to
// plan the day, Doing/Done show live status; Done stays last (done work below
// active, ux-principles.md principle 9). Classification precedence is still
// Done > Today > Doing > Todo (a story never appears twice). Carryover is
// automatic, not enforced here: pins persist across days, and a 1-day
// personal project's unaccepted stories roll into the next day's iteration —
// both keep unfinished Today work in Today the next day. A client component
// (not the server page) so the "only current iteration" toggle can re-filter
// Todo + Doing without a round trip (doc-12: client-side, no persistence).
export function MyWorkSections({
  activeItems,
  doneItems,
  projects,
  currentIterationByProject,
  pinnedStoryIds,
}: {
  activeItems: MyWorkActiveItem[];
  doneItems: MyWorkDoneItem[];
  projects: MyWorkProject[];
  // Maps aren't serializable across the server/client boundary — passed as
  // entry arrays and rebuilt here.
  currentIterationByProject: ReadonlyArray<readonly [string, string | null]>;
  pinnedStoryIds: string[];
}) {
  const [onlyCurrentIteration, setOnlyCurrentIteration] = useState(false);

  const iterationMap = useMemo(() => new Map(currentIterationByProject), [currentIterationByProject]);
  const pinnedSet = useMemo(() => new Set(pinnedStoryIds), [pinnedStoryIds]);

  const { today, doing, todo } = useMemo(
    () => buildMyWorkSections(activeItems, projects, iterationMap, pinnedSet, onlyCurrentIteration),
    [activeItems, projects, iterationMap, pinnedSet, onlyCurrentIteration],
  );
  // Unfiltered counts drive the toggle's own visibility — gating it on the
  // filtered todo/doing would let checking the box empty both lists and hide
  // the only control that could uncheck it again (no persistence to recover from).
  const hasFilterableItems = useMemo(() => {
    const unfiltered = buildMyWorkSections(activeItems, projects, iterationMap, pinnedSet, false);
    return unfiltered.todo.length > 0 || unfiltered.doing.length > 0;
  }, [activeItems, projects, iterationMap, pinnedSet]);
  const todayKey = utcTodayKey();
  const doneGroups = useMemo(() => groupDoneByDate(doneItems), [doneItems]);

  const isEmpty =
    today.length === 0 && doing.length === 0 && todo.length === 0 && doneItems.length === 0;

  return (
    <div>
      {hasFilterableItems && (
        <label className="mb-4 flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyCurrentIteration}
            onChange={(e) => setOnlyCurrentIteration(e.target.checked)}
            className="size-4 rounded border-input"
          />
          Only current iteration
        </label>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Stories assigned to you across your projects show up here — add a
          personal task above, or pin any story to plan your day.
        </p>
      )}

      {/* Render order: Todo (backlog) -> Today (planned) -> Doing (live) -> Done (last). */}
      {todo.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Todo</h2>
          {todo.map((group) => (
            <div key={group.projectId} className="mb-4">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.projectName}</h3>
              <div className="flex flex-col gap-1.5">
                {group.stories.map((story) => (
                  <MyWorkRow key={story.id} story={story.row} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {today.length > 0 && (
        <Section title="Today">
          {today.map((story) => (
            <MyWorkRow key={story.id} story={story.row} />
          ))}
        </Section>
      )}

      {doing.length > 0 && (
        <Section title="Doing">
          {doing.map((story) => (
            <MyWorkRow key={story.id} story={story.row} />
          ))}
        </Section>
      )}

      {doneGroups.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Done</h2>
          {doneGroups.map((group) => (
            <div key={group.dateKey} className="mb-4">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {doneDateLabel(group.dateKey, todayKey)}
              </h3>
              <div className="flex flex-col gap-1.5">
                {group.stories.map((story) => (
                  <MyWorkRow key={story.row.id} story={story.row} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
