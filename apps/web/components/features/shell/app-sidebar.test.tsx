import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1/board" }));
vi.mock("@/app/dashboard/actions", () => ({ signOut: vi.fn() }));

import { AppSidebar, type ProjectRef } from "./app-sidebar";

const CURRENT_PROJECT: ProjectRef = {
  id: "p1",
  name: "Current Project",
  isFavorite: false,
  isArchived: false,
};

describe("AppSidebar project switcher", () => {
  it("lists favorited projects before non-favorited ones", async () => {
    const projects: ProjectRef[] = [
      CURRENT_PROJECT,
      { id: "p2", name: "Zeta Non-Favorite", isFavorite: false, isArchived: false },
      { id: "p3", name: "Alpha Favorite", isFavorite: true, isArchived: false },
    ];
    render(<AppSidebar project={CURRENT_PROJECT} projects={projects} username="dev" />);

    // Radix's DropdownMenu needs real pointer/focus event sequencing to open
    // in jsdom — plain fireEvent.click on the trigger doesn't open it. This
    // repo's existing project-card-menu.test.tsx / story-peek-menu.test.tsx
    // already established userEvent as the fix; this test follows the same
    // precedent to reveal the switcher's menuitems.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Current Project" }));

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    const favoriteIndex = items.findIndex((t) => t?.includes("Alpha Favorite"));
    const nonFavoriteIndex = items.findIndex((t) => t?.includes("Zeta Non-Favorite"));
    expect(favoriteIndex).toBeGreaterThanOrEqual(0);
    expect(favoriteIndex).toBeLessThan(nonFavoriteIndex);
  });

  it("shows a pin icon next to favorited projects only", async () => {
    const projects: ProjectRef[] = [
      CURRENT_PROJECT,
      { id: "p2", name: "Zeta Non-Favorite", isFavorite: false, isArchived: false },
      { id: "p3", name: "Alpha Favorite", isFavorite: true, isArchived: false },
    ];
    render(<AppSidebar project={CURRENT_PROJECT} projects={projects} username="dev" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Current Project" }));

    const items = screen.getAllByRole("menuitem");
    const favoriteItem = items.find((el) => el.textContent?.includes("Alpha Favorite"));
    const nonFavoriteItem = items.find((el) => el.textContent?.includes("Zeta Non-Favorite"));

    expect(favoriteItem?.querySelector('[data-testid="pin-icon"]')).not.toBeNull();
    expect(nonFavoriteItem?.querySelector('[data-testid="pin-icon"]')).toBeNull();
  });

  it("excludes archived projects from the dropdown", async () => {
    const projects: ProjectRef[] = [
      CURRENT_PROJECT,
      { id: "p2", name: "Active Project", isFavorite: false, isArchived: false },
      { id: "p3", name: "Archived Project", isFavorite: false, isArchived: true },
    ];
    render(<AppSidebar project={CURRENT_PROJECT} projects={projects} username="dev" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Current Project" }));

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items.some((t) => t?.includes("Active Project"))).toBe(true);
    expect(items.some((t) => t?.includes("Archived Project"))).toBe(false);
  });

  it("lists My Work above the Projects list", async () => {
    render(<AppSidebar project={CURRENT_PROJECT} projects={[CURRENT_PROJECT]} username="dev" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Current Project" }));

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    const myWorkIndex = items.findIndex((t) => t?.includes("My Work"));
    const projectIndex = items.findIndex((t) => t?.includes("Current Project"));
    expect(myWorkIndex).toBeGreaterThanOrEqual(0);
    expect(myWorkIndex).toBeLessThan(projectIndex);
  });
});

describe("AppSidebar with no current project (My Work)", () => {
  it("shows 'My Work' as the switcher trigger label", () => {
    render(<AppSidebar project={null} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.getByRole("button", { name: "My Work" })).toBeInTheDocument();
  });

  it("omits the per-project section nav", () => {
    render(<AppSidebar project={null} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.queryByRole("link", { name: /board/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
  });
});
