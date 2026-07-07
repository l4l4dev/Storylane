import { expect, test } from "@playwright/test";
import { backdateCurrentIteration, estimateStory } from "./helpers/admin-client";

test("create project, add a story, accept it, and roll over the iteration", async ({ page }) => {
  const projectName = `E2E Core Flow ${Date.now()}`;
  const storyTitle = `Ship the thing ${Date.now()}`;

  // 1. Sign in as the seeded local dev user.
  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Continue as dev user" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 2. Create a project (Pivotal is the default mode — leave it unchanged).
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();

  // createProject redirects back to /dashboard; open the new project from there.
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: projectName }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);

  const projectId = page.url().match(/\/projects\/([0-9a-f-]+)\/board/)?.[1];
  if (!projectId) {
    throw new Error(`Could not extract project id from board URL: ${page.url()}`);
  }

  // 3. Add a story via the current iteration's quick-add (List view is the default).
  await page.getByRole("button", { name: /Add story/ }).first().click();
  await page.getByRole("textbox", { name: "New story title" }).fill(storyTitle);
  await page.keyboard.press("Enter");

  await expect(page.getByText(storyTitle, { exact: true })).toBeVisible();

  // 4. Estimate it directly via the DB (an unestimated feature can't be
  //    Started — see transition-buttons.tsx) and reload to pick it up. The
  //    side-peek UI isn't what this spec exercises (that's quick-add,
  //    one-click transitions, and iteration rollover below).
  await estimateStory(projectId, storyTitle, 3);
  await page.reload();

  // 5. Walk the story through to Accepted using the row's one-click
  //    transition buttons (spec/screens.md "Story row UX (List view)"). The
  //    sortable <li> wrapper's accessible name also contains each of these
  //    labels as a substring, so `exact: true` is required to target only
  //    the actual submit button.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("button", { name: "Deliver", exact: true }).click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Accepted")).toBeVisible();

  // 6. Force the current iteration to finalize on next load (real time
  //    can't be waited out here — see the helper's doc comment) and
  //    trigger the lazy rollover by reloading the board.
  await backdateCurrentIteration(projectId);
  await page.reload();

  // 7. The finalized iteration (with velocity = the accepted story's
  //    points) and its story should now show on the Iterations page.
  await page.goto(`/projects/${projectId}/iterations`);
  await expect(page.getByText(storyTitle)).toBeVisible();
  await expect(page.getByText(/3\s*pts/)).toBeVisible();
});
