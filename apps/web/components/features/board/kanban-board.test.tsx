import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinishIterationButton, IterationGoalBar } from "./kanban-board";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { updateIterationGoalMock, finishIterationMock } = vi.hoisted(() => ({
  updateIterationGoalMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  finishIterationMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  updateIterationGoal: updateIterationGoalMock,
  finishIteration: finishIterationMock,
}));

describe("IterationGoalBar", () => {
  beforeEach(() => {
    updateIterationGoalMock.mockClear();
  });

  it("commits the goal on Enter and shows a brief confirmation", async () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
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
    expect(screen.getByText("Saved ✓")).toBeInTheDocument();
  });

  it("reverts to the last saved value on Escape without saving", () => {
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="Original goal" />);
    const input: HTMLInputElement = screen.getByRole("textbox", { name: "Iteration goal" });

    fireEvent.change(input, { target: { value: "half-typed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("Original goal");
    expect(updateIterationGoalMock).not.toHaveBeenCalled();
  });

  it("keeps the typed value and shows an error when the save fails", async () => {
    updateIterationGoalMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<IterationGoalBar projectId="p1" iterationId="i1" initialGoal="" />);
    const input: HTMLInputElement = screen.getByRole("textbox", { name: "Iteration goal" });

    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(input.value).toBe("Ship the thing");
    expect(screen.getByText("Not a member of this project")).toBeInTheDocument();
  });
});

describe("FinishIterationButton", () => {
  beforeEach(() => {
    finishIterationMock.mockClear();
  });

  it("renders nothing when not visible (viewer role)", () => {
    const { container } = render(
      <FinishIterationButton projectId="p1" iterationNumber={3} visible={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("requires confirmation before calling finishIteration", async () => {
    render(<FinishIterationButton projectId="p1" iterationNumber={3} visible={true} />);

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
  });

  it("shows an error and keeps the dialog open when finishIteration fails", async () => {
    finishIterationMock.mockRejectedValueOnce(new Error("Only project owners or members can finish an iteration"));
    render(<FinishIterationButton projectId="p1" iterationNumber={3} visible={true} />);

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
});
