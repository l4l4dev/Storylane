import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddEpicButton } from "./add-epic-button";

describe("AddEpicButton", () => {
  it("commits on Enter and clears the field back to blank", async () => {
    const onCreate = vi.fn<(title: string) => Promise<void>>(() => Promise.resolve());
    render(<AddEpicButton onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    const input = screen.getByRole("textbox", { name: "New epic title" });
    fireEvent.change(input, { target: { value: "Fresh Epic" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledWith("Fresh Epic");
    expect(screen.getByRole("button", { name: "Add epic" })).toBeInTheDocument();
  });

  // Discards rather than commits (matches DraftStoryCard's quick-add
  // convention) — clicking elsewhere mid-type must not create a real epic.
  it("discards on blur without calling onCreate", () => {
    const onCreate = vi.fn<(title: string) => Promise<void>>(() => Promise.resolve());
    render(<AddEpicButton onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    const input = screen.getByRole("textbox", { name: "New epic title" });
    fireEvent.change(input, { target: { value: "Half typed" } });
    fireEvent.blur(input);

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add epic" })).toBeInTheDocument();
  });

  it("discards on Escape", () => {
    const onCreate = vi.fn<(title: string) => Promise<void>>(() => Promise.resolve());
    render(<AddEpicButton onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    const input = screen.getByRole("textbox", { name: "New epic title" });
    fireEvent.change(input, { target: { value: "Half typed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCreate).not.toHaveBeenCalled();
  });
});
