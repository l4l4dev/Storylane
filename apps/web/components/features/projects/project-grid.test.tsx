import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectGrid } from "./project-grid";
import type { ProjectCardData } from "./project-card";

function project(overrides: Partial<ProjectCardData> = {}): ProjectCardData {
  return {
    id: "p1",
    name: "Storylane",
    description: null,
    workflowMode: "tracker",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    members: [],
    isFavorite: false,
    isOwner: false,
    archivedAt: null,
    ...overrides,
  };
}

describe("ProjectGrid", () => {
  it("hides archived projects until the Archived filter is toggled on", () => {
    const projects = [
      project({ id: "a", name: "Active One" }),
      project({ id: "b", name: "Archived One", archivedAt: "2026-07-01T00:00:00.000Z" }),
    ];
    render(<ProjectGrid projects={projects} />);

    expect(screen.getByText("Active One")).toBeInTheDocument();
    expect(screen.queryByText("Archived One")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /archived/i }));
    expect(screen.getByText("Archived One")).toBeInTheDocument();
  });

  it("filters by the search box", () => {
    const projects = [project({ id: "a", name: "Storylane Web" }), project({ id: "b", name: "Other Project" })];
    render(<ProjectGrid projects={projects} />);

    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "storylane" } });

    expect(screen.getByText("Storylane Web")).toBeInTheDocument();
    expect(screen.queryByText("Other Project")).not.toBeInTheDocument();
  });

  it("re-sorts by name when the sort select changes", () => {
    const projects = [project({ id: "a", name: "Zeta" }), project({ id: "b", name: "Beta" })];
    render(<ProjectGrid projects={projects} />);

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });

    // ProjectCard's title renders as a Link (project-card.tsx: `<CardTitle><Link
    // href={...}>{project.name}</Link></CardTitle>`), not a heading element —
    // CardTitle (components/ui/card.tsx) is a plain styled <div>, so querying
    // by heading role would match nothing. Query by link role instead, which
    // reflects the actual rendered markup and is still one unambiguous
    // element per card.
    const names = screen.getAllByRole("link").map((el) => el.textContent);
    expect(names).toEqual(["Beta", "Zeta"]);
  });

  it("shows the empty state when there are no projects at all", () => {
    render(<ProjectGrid projects={[]} />);
    expect(screen.getByText("No projects yet. Create your first one to get started.")).toBeInTheDocument();
  });

  it("renders archived projects in a separate 'Archived' section below all active ones", () => {
    const projects = [
      // Archived most recently, so a flat "Last updated" sort would have
      // put it first if the two groups weren't kept apart.
      project({
        id: "archived",
        name: "Archived One",
        archivedAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      }),
      project({ id: "active", name: "Active One", updatedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    render(<ProjectGrid projects={projects} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /archived/i }));

    const heading = screen.getByRole("heading", { name: "Archived" });
    const names = screen.getAllByRole("link").map((el) => el.textContent);
    // Both projects render (Active One first, Archived One after the heading).
    expect(names).toEqual(["Active One", "Archived One"]);
    // The heading sits after the active card and before the archived one in
    // document order — i.e. it's a trailing section, not interleaved.
    const activeLink = screen.getByRole("link", { name: "Active One" });
    const archivedLink = screen.getByRole("link", { name: "Archived One" });
    expect(
      activeLink.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(archivedLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
