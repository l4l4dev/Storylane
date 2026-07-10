import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileSettingsForm } from "./profile-settings-form";

// TASK-5 AC #4: covers both the success and validation-error paths of the
// account settings form. The `updateProfile` server action itself is
// stubbed — its own validation/RLS behavior isn't something a component
// test can exercise without a real Supabase client.
const updateProfileMock = vi.fn();
vi.mock("@/app/settings/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/settings/actions")>();
  return { ...actual, updateProfile: (...args: unknown[]) => updateProfileMock(...args) };
});

describe("ProfileSettingsForm", () => {
  it("pre-fills the display name and username inputs", () => {
    render(<ProfileSettingsForm username="dev_user" displayName="Dev User" />);

    expect(screen.getByLabelText("Display name")).toHaveValue("Dev User");
    expect(screen.getByLabelText("Username")).toHaveValue("dev_user");
  });

  it("shows a success message after saving", async () => {
    updateProfileMock.mockResolvedValueOnce({ success: "Saved." });
    const user = userEvent.setup();
    render(<ProfileSettingsForm username="dev_user" displayName="Dev User" />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows a validation error message from the action", async () => {
    updateProfileMock.mockResolvedValueOnce({ error: "That username is already taken." });
    const user = userEvent.setup();
    render(<ProfileSettingsForm username="dev_user" displayName="Dev User" />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("That username is already taken.")).toBeInTheDocument();
  });
});
