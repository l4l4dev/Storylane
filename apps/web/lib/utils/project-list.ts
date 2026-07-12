// Pure, framework-free filter/sort for the /dashboard project grid
// (spec/screens.md "Projects page"). Applied client-side over the
// already-fetched project list — no new server query per keystroke.

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
    // Archived always sorts after every active project (TASK-32) —
    // outranks favorite/sort so a recently-archived project (its
    // updated_at just changed) can't jump to the top of a "Last updated"
    // list. ProjectGrid renders the two groups as separate sections; this
    // ordering just keeps the flat list itself already partitioned that
    // way.
    if (a.isArchived !== b.isArchived) {
      return a.isArchived ? 1 : -1;
    }
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
