import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WipLimitMenu } from "./free-board";

const { setStatusWipLimitMock } = vi.hoisted(() => ({
  setStatusWipLimitMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/settings/actions", () => ({
  setStatusWipLimit: setStatusWipLimitMock,
}));

describe("WipLimitMenu", () => {
  beforeEach(() => {
    setStatusWipLimitMock.mockClear();
  });

  it("saves a new limit", async () => {
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={null} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    const input = await screen.findByLabelText("WIP limit");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(setStatusWipLimitMock).toHaveBeenCalledTimes(1);
    const formData = setStatusWipLimitMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("setStatusWipLimit was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("status_id")).toBe("s1");
    expect(formData.get("wip_limit")).toBe("5");
  });

  it("shows a Clear button only when a limit is already set, and clearing sends an empty value", async () => {
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={3} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    await screen.findByLabelText("WIP limit");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(setStatusWipLimitMock).toHaveBeenCalledTimes(1);
    const formData = setStatusWipLimitMock.mock.calls[0]?.[0];
    expect(formData?.get("wip_limit")).toBe("");
  });

  it("does not show a Clear button when no limit is set", async () => {
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={null} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));
    await screen.findByLabelText("WIP limit");
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("shows an error and keeps the menu open when saving fails", async () => {
    // A value that passes the input's own min=1 constraint (jsdom enforces
    // HTML5 validation and silently blocks submission otherwise) — the
    // rejection this asserts on is a server-side failure, not a client
    // validation error.
    setStatusWipLimitMock.mockRejectedValueOnce(new Error("Failed to update WIP limit"));
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={null} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    const input = await screen.findByLabelText("WIP limit");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update WIP limit");
  });
});
