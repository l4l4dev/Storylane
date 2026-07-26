import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EpicsPageAddButton } from "./epics-page-add-button";

const { pushMock, createEpicMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createEpicMock: vi.fn<(input: unknown) => Promise<{ ok: boolean; id?: string; message?: string }>>(() =>
    Promise.resolve({ ok: true, id: "e-new" }),
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  createEpic: createEpicMock,
}));

describe("EpicsPageAddButton", () => {
  // ux-principles principle 10: a successful create lands the user in the
  // thing they created.
  it("creates the epic and navigates to it", async () => {
    pushMock.mockClear();
    createEpicMock.mockClear();
    createEpicMock.mockResolvedValue({ ok: true, id: "e-new" });
    render(<EpicsPageAddButton projectId="p1" />);

    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.change(screen.getByLabelText("New epic title"), { target: { value: "Fresh Epic" } });
    fireEvent.keyDown(screen.getByLabelText("New epic title"), { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(createEpicMock).toHaveBeenCalledWith({ projectId: "p1", title: "Fresh Epic" });
    expect(pushMock).toHaveBeenCalledWith("/projects/p1/epics?epic=e-new");
  });

  it("surfaces a failure instead of navigating", async () => {
    pushMock.mockClear();
    createEpicMock.mockResolvedValue({ ok: false, message: "Title is required" });
    render(<EpicsPageAddButton projectId="p1" />);

    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.change(screen.getByLabelText("New epic title"), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByLabelText("New epic title"), { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Title is required")).toBeInTheDocument();
  });
});
