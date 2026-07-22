// Pure classification/ordering logic for the My Work screen (doc-14 "My Work
// Kanban rework"). Framework-free like the rest of lib/utils — the page
// (server) shapes DB rows into these types, calls classifyMyWork, and hands
// the four columns to the renderer.
//
// Two independent axes (doc-14 "Classification", TASK-131 AC #11 ROUND-4):
//   - Done is completion-history scoped and ADDITIVE — every story_completions
//     row for the viewer is a Done entry, plus unmapped local_status='done'
//     marks. It is evaluated independently of the active axis, so a story
//     completed earlier and now reopened+assigned shows in BOTH Done and Doing.
//   - Todo/Today/Doing are current-assignee scoped, gated only by "real state
//     category != done" — see assignedColumn.

import type { StateCategory } from "@storylane/core";

export type MyWorkColumn = "todo" | "today" | "doing" | "done";

export type MyWorkProject = {
  id: string;
  name: string;
  // The viewer's own personal project (projects.is_personal AND created_by =
  // viewer, resolved by the page — TASK-103). Sorts groups first.
  isPersonal: boolean;
};

// An assigned, non-Icebox story in the viewer's My Work base scope, plus the
// per-viewer marks needed to place it. `category` is the real state category
// (Icebox filtered upstream, so non-null). `mapped` = the project has a valid
// in_progress Doing mapping, so Doing/Todo is derived from the real state and
// local_status is ignored. `S` is the render payload the page attaches.
export type MyWorkStory<S = unknown> = {
  id: string;
  projectId: string;
  position: number;
  category: StateCategory;
  isToday: boolean;
  localStatus: "todo" | "doing" | "done" | null;
  mapped: boolean;
  // my_work_story_state.updated_at — the completion "date" for an unmapped
  // local 'done' mark, which (unlike a real completion) has no
  // story_completions row of its own.
  localUpdatedAt: string | null;
  row: S;
};

export type MyWorkGroup<S> = {
  projectId: string;
  projectName: string;
  isPersonal: boolean;
  stories: MyWorkStory<S>[];
};

// A Done entry — either a story_completions row (live-joined to the story's
// current data by the page, so a reassigned-away completion still renders) or
// an unmapped local 'done' mark. Both reduce to a completion date + render row.
export type DoneEntry<S> = { completedAt: string; row: S };

export type MyWorkColumns<S> = {
  todo: MyWorkGroup<S>[];
  today: MyWorkStory<S>[];
  doing: MyWorkStory<S>[];
  done: DoneEntry<S>[];
};

function compareGroup(a: { isPersonal: boolean; name: string }, b: { isPersonal: boolean; name: string }): number {
  if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// Which active column an assigned story lands in — or "done" for an unmapped
// local completion mark, or null when its real state is already done (then it
// lives in the Done log via its story_completions row, never as an active
// card). doc-14 "Classification" + TASK-131 AC #11/#12 (ROUND-4).
export function assignedColumn<S>(s: MyWorkStory<S>): MyWorkColumn | null {
  // Real done: represented solely by its completion-log entry, not as a card.
  if (s.category === "done") return null;
  const derived: "todo" | "doing" = s.category === "in_progress" ? "doing" : "todo";
  const effective = s.mapped ? derived : (s.localStatus ?? derived);
  // Unmapped local 'done' — a cancellable local mark (NOT a permanent
  // completion log; it has no story_completions row). Outranks the Today
  // marker, matching the exclusive Done>Today ordering for a card's own slot.
  if (effective === "done") return "done";
  if (s.isToday) return "today";
  return effective;
}

/**
 * Splits the viewer's assigned non-Icebox stories + their completion history
 * into the four My Work columns (doc-14). `assigned` must already exclude
 * real-done stories' active representation is handled here (assignedColumn
 * returns null for them). `completions` is one entry per story_completions row,
 * live-joined to the story's current data by the caller.
 */
export function classifyMyWork<S>(
  assigned: readonly MyWorkStory<S>[],
  completions: readonly DoneEntry<S>[],
  projects: readonly MyWorkProject[],
): MyWorkColumns<S> {
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const today: MyWorkStory<S>[] = [];
  const doing: MyWorkStory<S>[] = [];
  const rest: MyWorkStory<S>[] = [];
  const localDone: DoneEntry<S>[] = [];
  for (const story of assigned) {
    switch (assignedColumn(story)) {
      case "today":
        today.push(story);
        break;
      case "doing":
        doing.push(story);
        break;
      case "todo":
        rest.push(story);
        break;
      case "done":
        localDone.push({ completedAt: story.localUpdatedAt ?? "", row: story.row });
        break;
      // null: real-done, shown only via its completion entry.
    }
  }

  const sortWithinGroup = (a: MyWorkStory<S>, b: MyWorkStory<S>) => a.position - b.position;
  const sortCrossProject = (a: MyWorkStory<S>, b: MyWorkStory<S>) => {
    const pa = projectById.get(a.projectId);
    const pb = projectById.get(b.projectId);
    if (pa && pb) {
      const byGroup = compareGroup(pa, pb);
      if (byGroup !== 0) return byGroup;
    }
    return sortWithinGroup(a, b);
  };
  today.sort(sortCrossProject);
  doing.sort(sortCrossProject);

  const groupsByProject = new Map<string, MyWorkStory<S>[]>();
  for (const story of rest) {
    const bucket = groupsByProject.get(story.projectId);
    if (bucket) bucket.push(story);
    else groupsByProject.set(story.projectId, [story]);
  }
  const todo: MyWorkGroup<S>[] = [...groupsByProject.entries()]
    .map(([projectId, groupStories]) => {
      const project = projectById.get(projectId);
      return {
        projectId,
        projectName: project?.name ?? "Unknown project",
        isPersonal: project?.isPersonal ?? false,
        stories: [...groupStories].sort(sortWithinGroup),
      };
    })
    .sort((a, b) =>
      compareGroup({ isPersonal: a.isPersonal, name: a.projectName }, { isPersonal: b.isPersonal, name: b.projectName }),
    );

  // Additive Done axis: real completions (incl. reassigned-away) + unmapped
  // local 'done' marks. A story can appear here AND in an active column when it
  // was completed before and is now reopened+assigned (AC #12b).
  return { todo, today, doing, done: [...completions, ...localDone] };
}

export type DoneStory = { completedAt: string };
export type DoneDateGroup<S> = { dateKey: string; stories: S[] };

/**
 * Groups done entries by the UTC date of their `completedAt`, newest date
 * first and newest-within-date first — the Done column's date headers
 * (doc-14). `dateKey` is a YYYY-MM-DD string; the caller turns it into a
 * "Today"/"Yesterday"/date label (kept out of this pure function so it stays
 * framework/locale-free).
 */
export function groupDoneByDate<S extends DoneStory>(stories: readonly S[]): DoneDateGroup<S>[] {
  const byDate = new Map<string, S[]>();
  for (const story of stories) {
    const dateKey = story.completedAt.slice(0, 10);
    const bucket = byDate.get(dateKey);
    if (bucket) bucket.push(story);
    else byDate.set(dateKey, [story]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, groupStories]) => ({
      dateKey,
      stories: [...groupStories].sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    }));
}
