import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MyWorkDoneWindowSettings } from "./my-work-done-window-settings";

// TASK-155 AC#4: the Done log retention window setting.
const updateMyWorkDoneWindowMock = vi.fn();
vi.mock("@/app/settings/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/settings/actions")>();
  return {
    ...actual,
    updateMyWorkDoneWindow: (...args: unknown[]) => updateMyWorkDoneWindowMock(...args),
  };
});

describe("MyWorkDoneWindowSettings", () => {
  it("shows the current window as the field's starting value", () => {
    render(<MyWorkDoneWindowSettings days={7} />);
    expect(screen.getByLabelText("Days")).toHaveValue(7);
  });

  it("saves a new window", async () => {
    updateMyWorkDoneWindowMock.mockResolvedValueOnce({ success: "Saved." });
    const user = userEvent.setup();
    render(<MyWorkDoneWindowSettings days={7} />);

    await user.clear(screen.getByLabelText("Days"));
    await user.type(screen.getByLabelText("Days"), "14");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("surfaces a validation error returned by the action", async () => {
    // The action itself is mocked, so the value submitted doesn't need to
    // actually be out of range — this just checks the component surfaces
    // whatever error the action returns.
    updateMyWorkDoneWindowMock.mockResolvedValueOnce({ error: "Enter a whole number of days between 1 and 90." });
    render(<MyWorkDoneWindowSettings days={7} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a whole number of days between 1 and 90.")).toBeInTheDocument();
  });
});
