import { expect, test } from "@playwright/test";
import { backdateCurrentIteration } from "./helpers/admin-client";
import { createProjectViaUI, loginAsDevUser } from "./helpers/flows";

test("create project, add a story, accept it, and roll over the iteration", async ({ page }) => {
  const storyTitle = `Ship the thing ${Date.now()}`;

  // 1. Sign in and create a project.
  await loginAsDevUser(page);
  const projectId = await createProjectViaUI(page, `E2E Core Flow ${Date.now()}`);

  // 2. Add a story via the current iteration's quick-add (List view is the
  //    default). Points are set on the draft card rather than through the DB:
  //    an unestimated feature can't be Started (transition-buttons.tsx), and
  //    the card carries the project's point scale, so the estimate is part of
  //    the same flow instead of a fixture written behind the UI's back.
  await page.getByRole("button", { name: "Add story to Current" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(storyTitle);
  await page.getByRole("combobox", { name: "Points" }).selectOption("3");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(storyTitle, { exact: true })).toBeVisible();

  // 3. Walk the story through to Accepted using the row's one-click
  //    transition buttons (spec/screens.md "Story row UX (List view)"). The
  //    sortable <li> wrapper's accessible name also contains each of these
  //    labels as a substring, so `exact: true` is required to target only
  //    the actual submit button.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("button", { name: "Deliver", exact: true }).click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Accepted")).toBeVisible();

  // 4. Force the current iteration to finalize on next load (real time
  //    can't be waited out here — see the helper's doc comment) and
  //    trigger the lazy rollover by reloading the board.
  await backdateCurrentIteration(projectId);
  await page.reload();

  // 5. The finalized iteration (with velocity = the accepted story's
  //    points) and its story should now show on the Iterations page.
  await page.goto(`/projects/${projectId}/iterations`);
  await expect(page.getByText(storyTitle)).toBeVisible();
  await expect(page.getByText(/3\s*pts/)).toBeVisible();
});
