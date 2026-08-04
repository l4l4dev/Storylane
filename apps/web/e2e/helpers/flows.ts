import { expect, type Page } from "@playwright/test";

/** Signs in as the seeded local dev user, who lands on My Work. */
export async function loginAsDevUser(page: Page) {
  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Continue as dev user" }).click();
  await expect(page).toHaveURL(/\/my-work$/);
}

/**
 * Creates a project the way a signed-in user reaches it: My Work has no create
 * form of its own, so the sidebar's project switcher links to /dashboard?new=1,
 * which lands on the panel pre-expanded. Returns the new project's id, read from
 * the board URL createProject redirects to.
 */
export async function createProjectViaUI(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);
  // Non-null: the assertion above is what guarantees the match.
  return page.url().match(/\/projects\/([0-9a-f-]+)\/board/)![1];
}
