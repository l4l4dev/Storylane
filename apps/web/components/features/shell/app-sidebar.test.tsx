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

  it("does not list My Work inside the Projects dropdown (it's a fixed link now)", async () => {
    render(<AppSidebar project={CURRENT_PROJECT} projects={[CURRENT_PROJECT]} username="dev" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Current Project" }));

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items.some((t) => t?.includes("My Work"))).toBe(false);
  });

  it("offers a 'New project' entry navigating to /dashboard?new=1", async () => {
    render(<AppSidebar project={CURRENT_PROJECT} projects={[CURRENT_PROJECT]} username="dev" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Current Project" }));

    const newProjectItem = screen.getByRole("menuitem", { name: /new project/i });
    expect(newProjectItem).toHaveAttribute("href", "/dashboard?new=1");
  });

  it("sizes the dropdown trigger as size=default (h-8), not size=sm", () => {
    render(<AppSidebar project={CURRENT_PROJECT} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.getByRole("button", { name: "Current Project" })).toHaveClass("h-8");
  });
});

describe("AppSidebar — fixed My Work link", () => {
  it("is a top-level nav link, always present", () => {
    render(<AppSidebar project={CURRENT_PROJECT} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.getByRole("link", { name: /my work/i })).toHaveAttribute("href", "/my-work");
  });

  it("is highlighted via aria-current when on /my-work", () => {
    render(<AppSidebar project={null} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.getByRole("link", { name: /my work/i })).toHaveAttribute("aria-current", "page");
  });

  it("is not highlighted when a project is active", () => {
    render(<AppSidebar project={CURRENT_PROJECT} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.getByRole("link", { name: /my work/i })).not.toHaveAttribute("aria-current");
  });
});

describe("AppSidebar with no current project (My Work)", () => {
  it("shows 'Projects' as the switcher trigger label", () => {
    render(<AppSidebar project={null} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
  });

  it("omits the per-project section nav", () => {
    render(<AppSidebar project={null} projects={[CURRENT_PROJECT]} username="dev" />);

    expect(screen.queryByRole("link", { name: /board/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
  });
});
