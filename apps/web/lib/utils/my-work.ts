// Pure grouping/ordering logic for the My Work screen (spec/screens.md "My
// Work"). Framework-free like the rest of lib/utils — the page (server) and
// the MyWorkSections client component shape DB rows into these types and do
// the query orchestration / rendering.
//
// doc-12 Thread A: four sections. CLASSIFICATION precedence (which section a
// story lands in, never two) is Done > Today > Doing > Todo; RENDER order is
// Todo, Today, Doing, Done — backlog, then planned-for-today, then live, with
// Done last (done work below active, ux-principles.md principle 9). Done comes
// from a separate query (only non-done stories reach buildMyWorkSections), so
// the Done>Today precedence is enforced by the query split, not here.

import type { StateCategory } from "@storylane/core";

export type MyWorkStory = {
  id: string;
  projectId: string;
  iterationId: string | null;
  position: number;
  // Its state's category — distinguishes Doing (in_progress) from Todo. null
  // never occurs for a My Work story (Icebox is filtered upstream), typed
  // nullable only because state_id is.
  category: StateCategory | null;
};

export type MyWorkProject = {
  id: string;
  name: string;
  // The viewer's own personal project (projects.is_personal AND created_by =
  // viewer, resolved by the page — TASK-103). Personal-project current-
  // iteration stories land in Today automatically; also sorts groups first.
  isPersonal: boolean;
};

export type MyWorkGroup<S> = {
  projectId: string;
  projectName: string;
  isPersonal: boolean;
  stories: S[];
};

function compareGroup(a: { isPersonal: boolean; name: string }, b: { isPersonal: boolean; name: string }): number {
  if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Splits the signed-in user's assigned, non-Icebox, non-done stories into:
 *   - today: a personal project's current-iteration stories + anything pinned
 *     (cross-project). Never filtered by `onlyCurrentIteration`.
 *   - doing: state category `in_progress`, not already in Today.
 *   - todo: everything else, grouped by project (personal first, then name;
 *     board position order within a group).
 * When `onlyCurrentIteration` is set, doing + todo drop stories not in their
 * own project's current iteration (Today is unaffected).
 */
export function buildMyWorkSections<S extends MyWorkStory>(
  stories: readonly S[],
  projects: readonly MyWorkProject[],
  currentIterationByProject: ReadonlyMap<string, string | null>,
  pinnedStoryIds: ReadonlySet<string>,
  onlyCurrentIteration = false,
): { today: S[]; doing: S[]; todo: MyWorkGroup<S>[] } {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const isInCurrentIteration = (story: S) =>
    story.iterationId !== null && story.iterationId === (currentIterationByProject.get(story.projectId) ?? null);

  const today: S[] = [];
  const doing: S[] = [];
  const rest: S[] = [];
  for (const story of stories) {
    const project = projectById.get(story.projectId);
    const inToday = (!!project?.isPersonal && isInCurrentIteration(story)) || pinnedStoryIds.has(story.id);
    if (inToday) {
      today.push(story);
      continue;
    }
    if (onlyCurrentIteration && !isInCurrentIteration(story)) {
      continue;
    }
    if (story.category === "in_progress") {
      doing.push(story);
    } else {
      rest.push(story);
    }
  }

  const sortWithinGroup = (a: S, b: S) => a.position - b.position;
  const sortCrossProject = (a: S, b: S) => {
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

  const groupsByProject = new Map<string, S[]>();
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

  return { today, doing, todo };
}

export type DoneStory = { completedAt: string };
export type DoneDateGroup<S> = { dateKey: string; stories: S[] };

/**
 * Groups done stories by the UTC date of their `completed_at`, newest date
 * first and newest-within-date first — the Done section's date headers
 * (spec/screens.md "My Work"). `dateKey` is a YYYY-MM-DD string; the caller
 * turns it into a "Today"/"Yesterday"/date label (kept out of this pure
 * function so it stays framework/locale-free).
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
