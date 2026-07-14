import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate } from "@/lib/utils/format";
import { FinishIterationButton, IterationGoalBar } from "./kanban-board";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

type FinishResult = { events: Array<Record<string, unknown>> };

const { updateIterationGoalMock, finishIterationMock } = vi.hoisted(() => ({
  updateIterationGoalMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  finishIterationMock: vi.fn<(formData: FormData) => Promise<{ events: Array<Record<string, unknown>> }>>(() =>
    Promise.resolve({ events: [{ kind: "finalized", number: 3, velocity: 5, skipped: false }] }),
  ),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  updateIterationGoal: updateIterationGoalMock,
  finishIteration: finishIterationMock,
}));

// TASK-45 / spec/ux-principles.md principle 5: a saved goal renders as text
// (or "Add goal…" ghost text when empty), not a permanently-visible input —
// clicking it opens the editor.
describe("IterationGoalBar", () => {
  beforeEach(() => {
    updateIterationGoalMock.mockClear();
  });

  it("shows the saved goal as text, and 'Add goal…' ghost text when empty — no input by default", () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="Ship the thing" />);
    expect(screen.queryByRole("textbox", { name: "Iteration goal" })).not.toBeInTheDocument();
    expect(screen.getByText("Ship the thing")).toBeInTheDocument();

    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    expect(screen.getByText("Add goal…")).toBeInTheDocument();
  });

  it("opens the editor on click, commits on Enter, and returns to text (no lingering input)", async () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration goal" });

    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateIterationGoalMock).toHaveBeenCalledTimes(1);
    const formData = updateIterationGoalMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("updateIterationGoal was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("iteration_id")).toBe("i1");
    expect(formData.get("goal")).toBe("Ship the thing");

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("textbox", { name: "Iteration goal" })).not.toBeInTheDocument();
  });

  it("also commits on blur", async () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration goal" });

    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.blur(input);

    expect(updateIterationGoalMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("textbox", { name: "Iteration goal" })).not.toBeInTheDocument();
  });

  it("reverts to the last saved value and closes the editor on Escape, without saving", () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="Original goal" />);
    fireEvent.click(screen.getByText("Original goal"));
    const input: HTMLInputElement = screen.getByRole("textbox", { name: "Iteration goal" });

    fireEvent.change(input, { target: { value: "half-typed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(updateIterationGoalMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Iteration goal" })).not.toBeInTheDocument();
    expect(screen.getByText("Original goal")).toBeInTheDocument();
  });

  it("keeps the editor open with the typed value and shows an error when the save fails", async () => {
    updateIterationGoalMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input: HTMLInputElement = screen.getByRole("textbox", { name: "Iteration goal" });

    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("textbox", { name: "Iteration goal" })).toHaveValue("Ship the thing");
    expect(screen.getByText("Not a member of this project")).toBeInTheDocument();
  });

  // fable-advisor review: marking the input `disabled` while saving used to
  // make the browser fire its own blur the instant it became disabled (a
  // disabled element can't hold focus), re-triggering commitAndClose while
  // the first save was still in flight — resubmitting the same goal, and
  // letting whichever call resolved first decide to close the editor even
  // if it was the losing (failed) one. `readOnly` avoids the forced blur;
  // this test forces the race directly regardless of that, proving the
  // in-flight guard itself holds.
  it("does not double-submit when a second commit is triggered while the first is still in flight", async () => {
    let resolveSave: (() => void) | undefined;
    updateIterationGoalMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration goal" });

    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The in-flight save hasn't resolved yet — a second trigger (e.g. the
    // blur a disabled/readOnly transition can cause) must not resubmit.
    fireEvent.blur(input);

    expect(updateIterationGoalMock).toHaveBeenCalledTimes(1);

    resolveSave?.();
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateIterationGoalMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox", { name: "Iteration goal" })).not.toBeInTheDocument();
  });

  it("gives the text-view button a descriptive accessible name", () => {
    const { unmount } = render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="Ship the thing" />);
    expect(screen.getByRole("button", { name: "Edit iteration goal: Ship the thing" })).toBeInTheDocument();
    unmount();

    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    expect(screen.getByRole("button", { name: "Add iteration goal" })).toBeInTheDocument();
  });

  it("returns focus to the goal button after a successful save closes the editor", async () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration goal" });
    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /Edit iteration goal/ })).toHaveFocus();
  });

  it("returns focus to the goal button after Escape closes the editor", () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="Original goal" />);
    fireEvent.click(screen.getByText("Original goal"));
    const input = screen.getByRole("textbox", { name: "Iteration goal" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("button", { name: /Edit iteration goal/ })).toHaveFocus();
  });
});

describe("FinishIterationButton", () => {
  // A comfortably-past start date so the default render is the "started"
  // (Finish, not Skip) path; the skip test overrides it with a future date.
  const STARTED = "2020-01-01";
  const FUTURE = "2999-01-01";

  beforeEach(() => {
    finishIterationMock.mockClear();
    finishIterationMock.mockResolvedValue({
      events: [{ kind: "finalized", number: 3, velocity: 5, skipped: false }],
    } satisfies FinishResult);
  });

  it("renders nothing when not visible (viewer role)", () => {
    const { container } = render(
      <FinishIterationButton
        projectId="p1"
        iterationId="i3"
        iterationNumber={3}
        iterationStartDate={STARTED}
        visible={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("requires confirmation before calling finishIteration, and sends the iteration id", async () => {
    render(
      <FinishIterationButton
        projectId="p1"
        iterationId="i3"
        iterationNumber={3}
        iterationStartDate={STARTED}
        visible={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finish iteration" }));
    expect(finishIterationMock).not.toHaveBeenCalled();

    const dialogButtons = await screen.findAllByRole("button", { name: "Finish iteration" });
    const confirmButton = dialogButtons[dialogButtons.length - 1];
    if (!confirmButton) {
      throw new Error("Confirmation button not found");
    }
    fireEvent.click(confirmButton);

    await act(async () => {
      await Promise.resolve();
    });
    expect(finishIterationMock).toHaveBeenCalledTimes(1);
    const formData = finishIterationMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("finishIteration was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("iteration_id")).toBe("i3");
  });

  it("shows an error and keeps the dialog open when finishIteration fails", async () => {
    finishIterationMock.mockRejectedValueOnce(new Error("Only project owners or members can finish an iteration"));
    render(
      <FinishIterationButton
        projectId="p1"
        iterationId="i3"
        iterationNumber={3}
        iterationStartDate={STARTED}
        visible={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finish iteration" }));
    const dialogButtons = await screen.findAllByRole("button", { name: "Finish iteration" });
    const confirmButton = dialogButtons[dialogButtons.length - 1];
    if (!confirmButton) {
      throw new Error("Confirmation button not found");
    }
    fireEvent.click(confirmButton);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Only project owners or members can finish an iteration")).toBeInTheDocument();
  });

  // TASK-38 AC #3: a not-yet-started iteration is finishable (skip), with a
  // confirm dialog that says what will happen.
  it("frames a not-yet-started iteration as a skip", async () => {
    render(
      <FinishIterationButton
        projectId="p1"
        iterationId="i3"
        iterationNumber={3}
        iterationStartDate={FUTURE}
        visible={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finish iteration" }));

    expect(await screen.findByText("Skip iteration #3?")).toBeInTheDocument();
    // The dialog names the start date (fable-advisor F2) and the skip
    // consequences. Expected date is computed via the same formatter so the
    // assertion is timezone-independent.
    expect(
      screen.getByText(new RegExp(`starts ${formatDate(FUTURE).replace(/\//g, "\\/")} and hasn't begun`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/its stories move to iteration #4/)).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Skip iteration" });
    fireEvent.click(confirmButton);

    await act(async () => {
      await Promise.resolve();
    });
    expect(finishIterationMock).toHaveBeenCalledTimes(1);
    expect(finishIterationMock.mock.calls[0]?.[0]?.get("iteration_id")).toBe("i3");
  });

  // TASK-38 AC #1/#2: a zero-change finish never ends in silence — the
  // no-op reason renders in the dialog instead (spec/ux-principles.md #2).
  it("shows the reason and keeps the dialog open when the finish is a no-op", async () => {
    finishIterationMock.mockResolvedValueOnce({
      events: [{ kind: "noop", reason: "already_finished" }],
    } satisfies FinishResult);
    render(
      <FinishIterationButton
        projectId="p1"
        iterationId="i3"
        iterationNumber={3}
        iterationStartDate={STARTED}
        visible={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finish iteration" }));
    const dialogButtons = await screen.findAllByRole("button", { name: "Finish iteration" });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]!);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/already finished/i)).toBeInTheDocument();
    // Dialog stays open with a Done affordance; the confirm action is gone
    // (the trigger outside the modal is aria-hidden while it's open, so no
    // "Finish iteration" button is reachable).
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish iteration" })).not.toBeInTheDocument();
  });
});
