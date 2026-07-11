import { act, fireEvent, render, screen } from "@testing-library/react";
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

  // TASK-11: the old composer morphed the trigger button itself into the
  // input. The trigger must now stay visible and unchanged, with the
  // composer appearing as a separate element alongside it.
  it("keeps the Add story trigger visible when the composer opens, with an explicit Add button", () => {
    render(<QuickAddComposer projectId="p1" target="backlog" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));
    expect(screen.getByRole("button", { name: /Add story/ })).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "New story title" });
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByText("Esc to close")).toBeInTheDocument();
  });

  it("creates when the explicit Add button is clicked (not just Enter)", async () => {
    render(<QuickAddComposer projectId="p1" target="backlog" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));

    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(quickCreateStoryMock).toHaveBeenCalledTimes(1);
    const formData = quickCreateStoryMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("quickCreateStory was not called with FormData");
    }
    expect(formData.get("title")).toBe("Ship the thing");

    await act(async () => {
      await Promise.resolve();
    });
  });

  it("includes before_item_id in the FormData for a backlog target when given", () => {
    render(<QuickAddComposer projectId="p1" target="backlog" beforeItemId="story:s2" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));

    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    const formData = quickCreateStoryMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("quickCreateStory was not called with FormData");
    }
    expect(formData.get("before_item_id")).toBe("story:s2");
  });

  it("omits before_item_id for a non-backlog target even when given", () => {
    render(<QuickAddComposer projectId="p1" target="unstarted" beforeItemId="story:s2" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));

    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    const formData = quickCreateStoryMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("quickCreateStory was not called with FormData");
    }
    expect(formData.get("before_item_id")).toBeNull();
  });

  it("creates on Enter, clears the input once creation succeeds, and stays open for the next add", async () => {
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

    await act(async () => {
      await Promise.resolve();
    });
    expect(input).toHaveValue("");
    expect(input).toBeInTheDocument();
  });

  // TASK-22: the typed title used to be cleared *before* the (void,
  // unawaited) create call — a failure lost the text with no story
  // created and no feedback. It must now survive a failed create and
  // surface an error instead.
  it("keeps the typed title and shows an error when creation fails", async () => {
    quickCreateStoryMock.mockRejectedValueOnce(new Error("No active iteration"));
    render(<QuickAddComposer projectId="p1" target="unstarted" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));

    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "Ship the thing" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await act(async () => {
      await Promise.resolve();
    });
    expect(input).toHaveValue("Ship the thing");
    expect(screen.getByRole("alert")).toHaveTextContent("No active iteration");
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
      throw new Error("quickCreateStory was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("title")).toBe("Free mode story");
    expect(formData.get("status_id")).toBe("cs1");
  });

  it("closes on Escape and discards the draft, leaving the trigger in place", () => {
    render(<QuickAddComposer projectId="p1" target="icebox" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));
    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "half-typed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add story/ })).toBeInTheDocument();
  });

  it("closes and discards the draft on an outside click", () => {
    render(
      <div>
        <button type="button">outside</button>
        <QuickAddComposer projectId="p1" target="icebox" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));
    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "half-typed" } });

    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add story/ })).toBeInTheDocument();
  });

  it("does not close on a click inside the composer", () => {
    render(<QuickAddComposer projectId="p1" target="icebox" />);
    fireEvent.click(screen.getByRole("button", { name: /Add story/ }));
    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "still typing" } });

    fireEvent.mouseDown(input);

    expect(screen.getByRole("textbox", { name: "New story title" })).toHaveValue("still typing");
  });
});
