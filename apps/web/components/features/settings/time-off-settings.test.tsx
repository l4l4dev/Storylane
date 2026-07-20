import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimeOffSettings } from "./time-off-settings";

// TASK-85 AC #3: the personal time-off UI. Server actions are stubbed — the
// self-only write rule is covered by working-day-calendar.integration.test.ts.
const addTimeOffMock = vi.fn();
vi.mock("@/app/settings/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/settings/actions")>();
  return {
    ...actual,
    removeTimeOff: vi.fn(),
    addTimeOff: (...args: unknown[]) => addTimeOffMock(...args),
  };
});

describe("TimeOffSettings", () => {
  it("lists booked dates with a remove control each", () => {
    render(<TimeOffSettings dates={["2026-08-20", "2026-08-21"]} />);

    expect(screen.getByText("2026/8/20")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove time off on 2026/8/21" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when nothing is booked", () => {
    render(<TimeOffSettings dates={[]} />);

    expect(screen.getByText("No time off booked.")).toBeInTheDocument();
  });

  it("surfaces a duplicate-date error from the action", async () => {
    addTimeOffMock.mockResolvedValueOnce({ error: "2026/8/20 is already marked as time off." });
    const user = userEvent.setup();
    render(<TimeOffSettings dates={["2026-08-20"]} />);

    await user.type(screen.getByLabelText("Date"), "2026-08-20");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("2026/8/20 is already marked as time off."),
    ).toBeInTheDocument();
  });
});
