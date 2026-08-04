import { expect, test } from "@playwright/test";
import { createProjectViaUI, loginAsDevUser } from "./helpers/flows";

// No screen may scroll the page itself sideways at 375px. The assertion is on
// the document not scrolling, not on the sidebar collapsing to its icon rail, so
// any future element that overflows the viewport fails here too.
//
// Board columns scroll horizontally inside their own container by design
// (kanban-columns-board), which is why the assertion is on documentElement
// rather than on any inner scroller.
test.describe("narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("no screen scrolls the page sideways at 375px", async ({ page }) => {
    await loginAsDevUser(page);

    // The sidebar keeps its destinations reachable as icons: the label is gone
    // from the rail, so the accessible name is what identifies the link.
    await expect(page.getByRole("link", { name: "My Work" })).toBeVisible();

    const projectId = await createProjectViaUI(page, `E2E Narrow ${Date.now()}`);

    async function expectNoPageOverflow(label: string) {
      // scrollWidth exceeding clientWidth on the root is the page itself
      // overflowing — the thing a phone user cannot scroll away from.
      //
      // Both waits are load-bearing, and this check is worthless without them:
      // `next dev` injects the stylesheet as a separate request, so at `load` the
      // page can still be unstyled — every row measures 0 wide and no overflow
      // can be observed at all. Fonts matter for the same reason one step later:
      // the fallback face is narrower than Geist, so a row measured before the
      // swap reads as fitting when the rendered one does not.
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(async () => {
        await document.fonts.ready;
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow, `${label} overflows the viewport horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
    }

    for (const path of [
      "/my-work",
      "/my-work/archive",
      "/dashboard",
      "/settings",
      `/projects/${projectId}/board`,
      `/projects/${projectId}/epics`,
      `/projects/${projectId}/iterations`,
      `/projects/${projectId}/activity`,
      `/projects/${projectId}/settings`,
    ]) {
      await page.goto(path);
      await expectNoPageOverflow(path);
    }

    // The board's inline editors are the only fixed-width thing left in the
    // content area (min-w-56). They survive 375px by riding a flex-wrap row, so
    // the reading is only honest with one of them actually open.
    await page.goto(`/projects/${projectId}/board`);
    await page.getByRole("button", { name: "Add iteration goal" }).click();
    await expect(page.getByRole("textbox", { name: "Iteration goal" })).toBeVisible();
    await expectNoPageOverflow("board with the iteration-goal editor open");
  });
});
