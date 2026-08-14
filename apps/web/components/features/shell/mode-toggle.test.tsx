import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { beforeAll, describe, expect, it } from "vitest";
import { ModeToggle } from "./mode-toggle";

// next-themes' enableSystem reads prefers-color-scheme via matchMedia, which
// jsdom doesn't implement.
beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
});

// The picker's checkmark must key off `theme` (the literal selection,
// including "system"), not `resolvedTheme` (which can never equal "system",
// so System could never show its own checkmark).
describe("ModeToggle", () => {
  it("lists all five themes and checks only the active selection", async () => {
    render(
      <ThemeProvider attribute="class" themes={["light", "dark", "slate", "moss"]} enableSystem defaultTheme="dark">
        <ModeToggle />
      </ThemeProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change theme" }));

    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((el) => el.textContent)).toEqual(["Light", "Ember", "Slate", "Moss", "System"]);

    const ember = screen.getByRole("menuitemradio", { name: "Ember" });
    expect(ember).toHaveAttribute("aria-checked", "true");
    for (const label of ["Light", "Slate", "Moss", "System"]) {
      expect(screen.getByRole("menuitemradio", { name: label })).toHaveAttribute("aria-checked", "false");
    }
  });

  it("moves the checkmark to System when selected, not to its resolved palette", async () => {
    render(
      <ThemeProvider attribute="class" themes={["light", "dark", "slate", "moss"]} enableSystem defaultTheme="dark">
        <ModeToggle />
      </ThemeProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    await user.click(screen.getByRole("menuitemradio", { name: "System" }));

    await user.click(screen.getByRole("button", { name: "Change theme" }));
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Ember" })).toHaveAttribute("aria-checked", "false");
  });
});
