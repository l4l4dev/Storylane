import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IterationHeaderRow, RowInsertMenu } from "./board-list-view";

const { deleteBacklogDividerMock, createBacklogDividerMock } = vi.hoisted(() => ({
  deleteBacklogDividerMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  createBacklogDividerMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  createBacklogDivider: createBacklogDividerMock,
  deleteBacklogDivider: deleteBacklogDividerMock,
  dropStoryInList: vi.fn(),
  upsertIterationGoal: vi.fn(),
}));

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

// TASK-42: the row "…" menu is the primary way to insert a note or
// iteration break at a chosen position — replacing pixel-hunting the
// hover-line's thin gap (kept as a secondary shortcut, unaffected here).
describe("RowInsertMenu", () => {
  const onError = vi.fn();

  beforeEach(() => {
    createBacklogDividerMock.mockClear();
    onError.mockClear();
  });

  function lastCallFormData() {
    const formData = createBacklogDividerMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("createBacklogDivider was not called with FormData");
    }
    return formData;
  }

  // "Top": aboveId anchors to the very first row.
  it("inserts an iteration break above (top position)", async () => {
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:first" belowId="story:second" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert iteration break above" }));

    expect(createBacklogDividerMock).toHaveBeenCalledTimes(1);
    const formData = lastCallFormData();
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("kind")).toBe("iteration_break");
    expect(formData.get("before_item_id")).toBe("story:first");
  });

  // "Middle": belowId anchors to a real next row, not the end of the list.
  it("inserts a note below (middle position) via the label dialog", async () => {
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:mid" belowId="story:next" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert note below" }));

    const input = screen.getByRole("textbox", { name: "New note label" });
    fireEvent.change(input, { target: { value: "Phase 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(createBacklogDividerMock).toHaveBeenCalledTimes(1);
    const formData = lastCallFormData();
    expect(formData.get("kind")).toBe("note");
    expect(formData.get("label")).toBe("Phase 2");
    expect(formData.get("before_item_id")).toBe("story:next");
    expect(screen.queryByRole("textbox", { name: "New note label" })).not.toBeInTheDocument();
  });

  // "Bottom": belowId is null at the very last row — no before_item_id
  // means append at the absolute end (same convention as InsertBetweenRows).
  it("inserts an iteration break below with no before_item_id at the bottom position", async () => {
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:last" belowId={null} onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert iteration break below" }));

    const formData = lastCallFormData();
    expect(formData.get("kind")).toBe("iteration_break");
    expect(formData.get("before_item_id")).toBeNull();
  });

  it("shows an error and keeps the dialog open when inserting a note fails", async () => {
    createBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:a" belowId="story:b" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert note above" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New note label" }), { target: { value: "Oops" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Not a member of this project");
    expect(screen.getByRole("textbox", { name: "New note label" })).toHaveValue("Oops");
  });

  // Unlike the note dialog (which has its own inline alert), an iteration
  // break has no per-row slot to show a failure without shifting layout —
  // it must report to the shared banner via onError instead of failing
  // silently (spec/ux-principles.md principle 2).
  it("reports a failed iteration break insert via onError instead of failing silently", async () => {
    createBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:a" belowId="story:b" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert iteration break below" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith("Not a member of this project");
  });
});
