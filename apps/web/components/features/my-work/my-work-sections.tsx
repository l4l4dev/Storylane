"use client";

import { useMemo } from "react";
import { groupDoneByDate, type MyWorkColumns } from "@/lib/utils/my-work";
import { addDays } from "@storylane/core";
import { formatDate, utcTodayKey } from "@/lib/utils/format";
import { MyWorkRow, type MyWorkRowData } from "./my-work-row";

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

// My Work's four columns (doc-14). Render order is Todo, Today, Doing, Done —
// Todo is the personal backlog, you move things into Today to plan the day,
// Doing/Done show status; Done stays last (done work below active,
// ux-principles.md principle 9). Classification is done server-side now (no
// more client-side "only current iteration" toggle, doc-14); this component
// only renders. Draggable columns are TASK-132.
export function MyWorkSections({ columns }: { columns: MyWorkColumns<MyWorkRowData> }) {
  const { todo, today, doing, done } = columns;
  const todayKey = utcTodayKey();
  const doneGroups = useMemo(() => groupDoneByDate(done), [done]);

  const isEmpty = todo.length === 0 && today.length === 0 && doing.length === 0 && done.length === 0;

  return (
    <div>
      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Stories assigned to you across your projects show up here — add a
          personal task above, or open a story to plan your day.
        </p>
      )}

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
                {group.stories.map((entry, i) => (
                  // A story can appear more than once in Done (completed twice,
                  // or a completion + an unmapped local mark), so key by index
                  // within the date group, not by story id.
                  <MyWorkRow key={`${entry.row.id}-${i}`} story={entry.row} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
