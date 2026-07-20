import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkingDaysSettings } from "./working-days-settings";

// TASK-85 AC #3: the project-side calendar UI. Server actions are stubbed —
// their RLS behaviour is covered by working-day-calendar.integration.test.ts.
const createCalendarExceptionMock = vi.fn();
vi.mock("@/app/projects/[id]/settings/actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/projects/[id]/settings/actions")>();
  return {
    ...actual,
    updateWorkingWeekdays: vi.fn(),
    deleteCalendarException: vi.fn(),
    createCalendarException: (...args: unknown[]) => createCalendarExceptionMock(...args),
  };
});

const EXCEPTIONS = [
  { id: "e1", date: "2026-08-11", kind: "holiday" as const },
  { id: "e2", date: "2026-08-15", kind: "extra_workday" as const },
];

describe("WorkingDaysSettings", () => {
  it("checks exactly the project's working weekdays", () => {
    render(
      <WorkingDaysSettings
        projectId="p1"
        workingWeekdays={[1, 2, 3, 4, 5]}
        exceptions={[]}
        canEditWeekdays
        canManageExceptions
      />,
    );

    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(screen.getByLabelText(day)).toBeChecked();
    }
    for (const day of ["Sat", "Sun"]) {
      expect(screen.getByLabelText(day)).not.toBeChecked();
    }
  });

  it("lists exceptions with their kind", () => {
    render(
      <WorkingDaysSettings
        projectId="p1"
        workingWeekdays={[1]}
        exceptions={EXCEPTIONS}
        canEditWeekdays
        canManageExceptions
      />,
    );

    // Scoped to the list: the add form's <select> repeats both kind labels.
    const list = within(screen.getByRole("list"));
    expect(list.getByText("2026/8/11")).toBeInTheDocument();
    expect(list.getByText("Holiday")).toBeInTheDocument();
    expect(list.getByText("2026/8/15")).toBeInTheDocument();
    expect(list.getByText("Extra workday")).toBeInTheDocument();
  });

  it("hides every write control from a viewer", () => {
    render(
      <WorkingDaysSettings
        projectId="p1"
        workingWeekdays={[1, 3]}
        exceptions={EXCEPTIONS}
        canEditWeekdays={false}
        canManageExceptions={false}
      />,
    );

    // Read-only renders the value, not a row of dead checkboxes.
    expect(screen.queryByLabelText("Mon")).not.toBeInTheDocument();
    expect(screen.getByText("Mon, Wed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save working days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove 2026/8/11 exception" }),
    ).not.toBeInTheDocument();
  });

  // projects UPDATE RLS is owner-only while project_calendar_exceptions
  // accepts member writes — a member offered a weekday save button would only
  // get a failed write.
  it("lets a member edit exceptions but not the weekday default", () => {
    render(
      <WorkingDaysSettings
        projectId="p1"
        workingWeekdays={[1]}
        exceptions={EXCEPTIONS}
        canEditWeekdays={false}
        canManageExceptions
      />,
    );

    expect(screen.queryByLabelText("Mon")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save working days" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove 2026/8/11 exception" }),
    ).toBeInTheDocument();
  });

  it("surfaces a duplicate-date error from the action", async () => {
    createCalendarExceptionMock.mockResolvedValueOnce({
      error: "2026/8/11 already has an exception. Remove it first.",
    });
    const user = userEvent.setup();
    render(
      <WorkingDaysSettings
        projectId="p1"
        workingWeekdays={[1]}
        exceptions={EXCEPTIONS}
        canEditWeekdays
        canManageExceptions
      />,
    );

    await user.type(screen.getByLabelText("Date"), "2026-08-11");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("2026/8/11 already has an exception. Remove it first."),
    ).toBeInTheDocument();
  });
});
