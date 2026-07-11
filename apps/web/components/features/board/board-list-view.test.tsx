import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IterationHeaderRow } from "./board-list-view";

const { deleteBacklogDividerMock } = vi.hoisted(() => ({
  deleteBacklogDividerMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  createBacklogDivider: vi.fn(),
  deleteBacklogDivider: deleteBacklogDividerMock,
  dropStoryInList: vi.fn(),
  upsertIterationGoal: vi.fn(),
}));

// TASK-43: a manual iteration break's own row no longer renders (it used to
// linger forever as a separate "Iteration break" line, duplicated across
// however many groups a break had ever forced) — its only remaining UI is
// this removable badge on the header its boundary created.
describe("IterationHeaderRow", () => {
  beforeEach(() => {
    deleteBacklogDividerMock.mockClear();
  });

  function baseProps() {
    return {
      number: 4,
      points: 3,
      projectId: "p1",
      goal: "",
      projectedDates: null,
      collapsed: false,
      onToggle: vi.fn(),
    };
  }

  it("shows no manual-break badge for a header from an automatic capacity split", () => {
    render(<IterationHeaderRow {...baseProps()} />);
    expect(screen.queryByText("manual")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove manual iteration break" })).not.toBeInTheDocument();
  });

  it("shows a removable manual badge for a header a break forced, with no separate divider row", () => {
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove manual iteration break" })).toBeInTheDocument();
    // The old standalone divider row's label must not appear anywhere here.
    expect(screen.queryByText("Iteration break")).not.toBeInTheDocument();
  });

  it("deletes the correct divider when the badge's remove button is clicked", async () => {
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove manual iteration break" }));

    expect(deleteBacklogDividerMock).toHaveBeenCalledTimes(1);
    const formData = deleteBacklogDividerMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("deleteBacklogDivider was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("divider_id")).toBe("div-1");

    await act(async () => {
      await Promise.resolve();
    });
  });

  it("shows an error and keeps the badge when removal fails, instead of failing silently", async () => {
    deleteBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove manual iteration break" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Not a member of this project");
    expect(screen.getByRole("button", { name: "Remove manual iteration break" })).toBeInTheDocument();
  });
});
