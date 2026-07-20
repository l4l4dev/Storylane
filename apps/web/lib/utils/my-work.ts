// Pure grouping/ordering logic for the My Work screen (spec/screens.md "My
// Work", doc-8 §9). Framework-free like the rest of lib/utils — the
// Server Component page shapes the DB rows into MyWorkStory and does the
// rest of the query orchestration.

export type MyWorkStory = {
  id: string;
  projectId: string;
  iterationId: string | null;
  position: number;
};

export type MyWorkProject = {
  id: string;
  name: string;
  // A "personal project" is just a project whose cadence is 1 day
  // (spec/velocity.md) — no separate personal-mode flag.
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
 * Splits the signed-in user's assigned, non-Icebox, non-done stories into
 * Today (a personal project's current-iteration stories, plus anything
 * pinned) and Assigned (everything else, grouped by project — personal
 * projects first, then project name; position order within a group).
 */
export function buildMyWorkSections<S extends MyWorkStory>(
  stories: readonly S[],
  projects: readonly MyWorkProject[],
  currentIterationByProject: ReadonlyMap<string, string | null>,
  pinnedStoryIds: ReadonlySet<string>,
): { today: S[]; assigned: MyWorkGroup<S>[] } {
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const today: S[] = [];
  const rest: S[] = [];
  for (const story of stories) {
    const project = projectById.get(story.projectId);
    const isCurrentIterationOfPersonalProject =
      !!project?.isPersonal &&
      story.iterationId !== null &&
      story.iterationId === (currentIterationByProject.get(story.projectId) ?? null);
    if (isCurrentIterationOfPersonalProject || pinnedStoryIds.has(story.id)) {
      today.push(story);
    } else {
      rest.push(story);
    }
  }

  const sortWithinGroup = (a: S, b: S) => a.position - b.position;
  today.sort((a, b) => {
    const pa = projectById.get(a.projectId);
    const pb = projectById.get(b.projectId);
    if (pa && pb) {
      const byGroup = compareGroup(pa, pb);
      if (byGroup !== 0) return byGroup;
    }
    return sortWithinGroup(a, b);
  });

  const groupsByProject = new Map<string, S[]>();
  for (const story of rest) {
    const bucket = groupsByProject.get(story.projectId);
    if (bucket) {
      bucket.push(story);
    } else {
      groupsByProject.set(story.projectId, [story]);
    }
  }

  const assigned: MyWorkGroup<S>[] = [...groupsByProject.entries()]
    .map(([projectId, groupStories]) => {
      const project = projectById.get(projectId);
      return {
        projectId,
        projectName: project?.name ?? "Unknown project",
        isPersonal: project?.isPersonal ?? false,
        stories: [...groupStories].sort(sortWithinGroup),
      };
    })
    .sort((a, b) => compareGroup({ isPersonal: a.isPersonal, name: a.projectName }, { isPersonal: b.isPersonal, name: b.projectName }));

  return { today, assigned };
}
