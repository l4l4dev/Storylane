// Pure, framework-free filter/sort for the /dashboard project grid
// (spec/screens.md "Projects page", TASK-8). Applied client-side over the
// already-fetched project list — no new server query, same scale
// assumption as TASK-7.

export type ProjectListItem = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  isArchived: boolean;
};

export type ProjectSort = "updated" | "name" | "created";

export function filterAndSortProjects(
  projects: ReadonlyArray<ProjectListItem>,
  options: { search: string; sort: ProjectSort; showArchived: boolean },
): ProjectListItem[] {
  const query = options.search.trim().toLowerCase();

  const filtered = projects.filter((p) => {
    if (!options.showArchived && p.isArchived) {
      return false;
    }
    if (query && !p.name.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    switch (options.sort) {
      case "name":
        return a.name.localeCompare(b.name);
      case "created":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "updated":
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });
}
