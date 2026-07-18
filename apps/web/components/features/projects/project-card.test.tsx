import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectCard, type ProjectCardData } from "./project-card";

vi.mock("./project-card-menu", () => ({
  ProjectCardMenu: ({ isArchived }: { isArchived: boolean }) => (
    <div data-testid="project-card-menu">{isArchived ? "archived-menu" : "active-menu"}</div>
  ),
}));

function baseProject(overrides: Partial<ProjectCardData> = {}): ProjectCardData {
  return {
    id: "p1",
    name: "Storylane",
    description: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    members: [],
    isFavorite: false,
    isOwner: false,
    archivedAt: null,
    ...overrides,
  };
}

describe("ProjectCard", () => {
  it("shows the Tracker badge and iteration/velocity summary", () => {
    render(
      <ProjectCard
        project={baseProject({ currentIterationNumber: 4, velocity: 12 })}
      />,
    );
    expect(screen.getByText("Tracker")).toBeInTheDocument();
    expect(screen.getByText("Iteration #4 · velocity 12 pts")).toBeInTheDocument();
  });

  it("caps overlapping member avatars with a +N badge", () => {
    const members = Array.from({ length: 5 }, (_, i) => ({
      userId: `u${i}`,
      displayName: `User ${i}`,
      avatarUrl: null,
    }));
    render(<ProjectCard project={baseProject({ members })} />);
    // First 4 rendered as initials, 5th collapsed into "+1".
    expect(screen.getByText("U0")).toBeInTheDocument();
    expect(screen.getByText("U3")).toBeInTheDocument();
    expect(screen.queryByText("U4")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("renders no +N badge when member count is at or below the cap", () => {
    const members = Array.from({ length: 3 }, (_, i) => ({
      userId: `u${i}`,
      displayName: `User ${i}`,
      avatarUrl: null,
    }));
    render(<ProjectCard project={baseProject({ members })} />);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("shows an Archived badge when the project is archived", () => {
    render(<ProjectCard project={baseProject({ archivedAt: "2026-07-10T00:00:00.000Z" })} />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("renders a long project name in full, without an ellipsis-truncating class", () => {
    const longName = "A Very Long Project Name That Would Previously Have Been Truncated With An Ellipsis";
    render(<ProjectCard project={baseProject({ name: longName })} />);
    const link = screen.getByRole("link", { name: longName });
    expect(link).toHaveTextContent(longName);
    expect(link.parentElement?.className).not.toMatch(/\btruncate\b/);
  });
});
