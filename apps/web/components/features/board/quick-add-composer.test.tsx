import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickAddComposer } from "./quick-add-composer";

const { quickCreateStoryMock, quickCreateStoryFreeMock } = vi.hoisted(() => ({
  quickCreateStoryMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  quickCreateStoryFreeMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  quickCreateStory: quickCreateStoryMock,
  quickCreateStoryFree: quickCreateStoryFreeMock,
}));

describe("QuickAddComposer", () => {
  beforeEach(() => {
    quickCreateStoryMock.mockClear();
    quickCreateStoryFreeMock.mockClear();
  });

  it("starts as an Add story button and opens an input in place", () => {
    render(<QuickAddComposer projectId="p1" target="backlog" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));
    expect(screen.getByRole("textbox", { name: "New story title" })).toHaveFocus();
  });

  it("creates on Enter, clears the input, and stays open for the next add", async () => {
    render(<QuickAddComposer projectId="p1" target="unstarted" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));

    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(quickCreateStoryMock).toHaveBeenCalledTimes(1);
    const formData = quickCreateStoryMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("quickCreateStory was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("title")).toBe("Ship the thing");
    expect(formData.get("target")).toBe("unstarted");
    expect(input).toHaveValue("");
    expect(input).toBeInTheDocument();
  });

  it("does not create from a blank title", () => {
    render(<QuickAddComposer projectId="p1" target="backlog" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));
    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(quickCreateStoryMock).not.toHaveBeenCalled();
  });

  it("creates via the free-mode action for a custom status column target", () => {
    render(<QuickAddComposer projectId="p1" target={{ customStatusId: "cs1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));

    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "Free mode story" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(quickCreateStoryFreeMock).toHaveBeenCalledTimes(1);
    expect(quickCreateStoryMock).not.toHaveBeenCalled();
    const formData = quickCreateStoryFreeMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("quickCreateStoryFree was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("title")).toBe("Free mode story");
    expect(formData.get("status_id")).toBe("cs1");
  });

  it("closes on Escape and discards the draft", () => {
    render(<QuickAddComposer projectId="p1" target="icebox" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));
    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "half-typed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add story/ })).toBeInTheDocument();
  });
});
