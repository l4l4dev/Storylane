import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1/board" }));
vi.mock("@/app/dashboard/actions", () => ({ signOut: vi.fn() }));

import { AppSidebar, type ProjectRef } from "./app-sidebar";

describe("AppSidebar project switcher", () => {
  it("lists favorited projects before non-favorited ones", async () => {
    const projects: ProjectRef[] = [
      { id: "p1", name: "Current Project", isFavorite: false },
      { id: "p2", name: "Zeta Non-Favorite", isFavorite: false },
      { id: "p3", name: "Alpha Favorite", isFavorite: true },
    ];
    render(
      <AppSidebar
        project={{ id: "p1", name: "Current Project", isFavorite: false }}
        projects={projects}
        username="dev"
      />,
    );

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
});
