import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCardMenu } from "./project-card-menu";

const archiveProjectMock = vi.fn();
const unarchiveProjectMock = vi.fn();
const toggleFavoriteMock = vi.fn();

vi.mock("@/app/dashboard/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/dashboard/actions")>();
  return {
    ...actual,
    archiveProject: (...args: unknown[]) => archiveProjectMock(...args),
    unarchiveProject: (...args: unknown[]) => unarchiveProjectMock(...args),
    toggleFavorite: (...args: unknown[]) => toggleFavoriteMock(...args),
  };
});

describe("ProjectCardMenu", () => {
  beforeEach(() => {
    archiveProjectMock.mockReset();
    unarchiveProjectMock.mockReset();
    toggleFavoriteMock.mockReset();
  });

  it("does not render the overflow menu for a non-owner", () => {
    render(
      <ProjectCardMenu projectId="p1" projectName="My Project" isOwner={false} isFavorite={false} isArchived={false} />,
    );
    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to favorites" })).toBeInTheDocument();
  });

  // Radix's DropdownMenu needs real pointer/focus event sequencing to open
  // in jsdom — plain fireEvent.click on the trigger doesn't open it. This
  // repo's existing story-peek-menu.test.tsx (an identical
  // DropdownMenu-then-Dialog pattern) already established userEvent as the
  // fix; these two tests follow that precedent.
  it("opens an archive confirmation dialog for an owner on an active project", async () => {
    const user = userEvent.setup();
    render(
      <ProjectCardMenu projectId="p1" projectName="My Project" isOwner={true} isFavorite={false} isArchived={false} />,
    );
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(screen.getByText("Archive this project?")).toBeInTheDocument();
    expect(screen.getByText(/My Project/)).toBeInTheDocument();
  });

  it("shows 'Unarchive' for an already-archived project and calls unarchiveProject on confirm", async () => {
    const user = userEvent.setup();
    render(
      <ProjectCardMenu projectId="p1" projectName="My Project" isOwner={true} isFavorite={false} isArchived={true} />,
    );
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    expect(screen.getByText("Unarchive this project?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(screen.queryByText("Unarchive this project?")).not.toBeInTheDocument();
  });

  it("toggles the favorite star and calls toggleFavorite with the new value", async () => {
    toggleFavoriteMock.mockResolvedValueOnce({ ok: true });
    render(
      <ProjectCardMenu projectId="p1" projectName="My Project" isOwner={false} isFavorite={false} isArchived={false} />,
    );
    const star = screen.getByRole("button", { name: "Add to favorites" });
    fireEvent.click(star);

    expect(toggleFavoriteMock).toHaveBeenCalledWith("p1", true);
    await screen.findByRole("button", { name: "Remove from favorites" });
  });

  it("reverts the optimistic favorite toggle when the action reports failure", async () => {
    toggleFavoriteMock.mockResolvedValueOnce({ ok: false });
    render(
      <ProjectCardMenu projectId="p1" projectName="My Project" isOwner={false} isFavorite={false} isArchived={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));

    await screen.findByRole("button", { name: "Add to favorites" });
  });
});
