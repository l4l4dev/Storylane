import { expect, test } from "@playwright/test";

// The audit's finding (TASK-217): the shell's sidebar was a fixed w-56, so at
// 375px it left 151px for the content — narrower than a single board column.
// It collapses to an icon rail below md now, and this is the check that it stays
// collapsed: the assertion is on the document not scrolling sideways, not on the
// rail's markup, so any future element that overflows the viewport fails here
// too.
//
// Board columns scroll horizontally inside their own container by design
// (kanban-columns-board), which is why the assertion is on documentElement
// rather than on any inner scroller.
test.describe("narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("no screen scrolls the page sideways at 375px", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByRole("button", { name: "Continue as dev user" }).click();
    await expect(page).toHaveURL(/\/my-work$/);

    // The sidebar keeps its destinations reachable as icons: the label is gone
    // from the rail, so the accessible name is what identifies the link.
    await expect(page.getByRole("link", { name: "My Work" })).toBeVisible();

    const projectName = `E2E Narrow ${Date.now()}`;
    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("menuitem", { name: "New project" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(projectName);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);

    const projectId = page.url().match(/\/projects\/([0-9a-f-]+)\/board/)?.[1];
    if (!projectId) {
      throw new Error(`Could not extract project id from board URL: ${page.url()}`);
    }

    async function expectNoPageOverflow(label: string) {
      // scrollWidth exceeding clientWidth on the root is the page itself
      // overflowing — the thing a phone user cannot scroll away from.
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow, `${label} overflows the viewport horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
    }

    for (const path of [
      "/my-work",
      "/dashboard",
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
