"use client";

import { useState } from "react";
import { filterAndSortProjects, type ProjectSort } from "@/lib/utils/project-list";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ProjectCard, type ProjectCardData } from "./project-card";

const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "name", label: "Name" },
  { value: "created", label: "Created" },
];

// Owns the search/sort/archived filter UI state (spec/screens.md "Projects
// page") and applies filterAndSortProjects client-side over the
// already-fetched project list — no new server query per keystroke.
export function ProjectGrid({ projects }: { projects: ProjectCardData[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProjectSort>("updated");
  const [showArchived, setShowArchived] = useState(false);

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No projects yet. Create your first one to get started.</p>
    );
  }

  const visible = filterAndSortProjects(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      isFavorite: p.isFavorite,
      isArchived: p.archivedAt !== null,
    })),
    { search, sort, showArchived },
  );
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const visibleProjects = visible
    .map((p) => projectById.get(p.id))
    .filter((p): p is ProjectCardData => p !== undefined);
  // filterAndSortProjects already sorts archived after every active project
  // — filtering into two groups here just splits that single ordered list
  // for rendering as separate sections (TASK-32), never mixed together.
  const activeProjects = visibleProjects.filter((p) => p.archivedAt === null);
  const archivedProjects = visibleProjects.filter((p) => p.archivedAt !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search projects"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <NativeSelect
          aria-label="Sort by"
          value={sort}
          onChange={(e) => setSort(e.target.value as ProjectSort)}
          className="w-auto"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            aria-label="Show archived projects"
          />
          Archived
        </label>
      </div>

      {visibleProjects.length > 0 ? (
        <>
          {activeProjects.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
          {archivedProjects.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Archived</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {archivedProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No projects match your search.</p>
      )}
    </div>
  );
}
