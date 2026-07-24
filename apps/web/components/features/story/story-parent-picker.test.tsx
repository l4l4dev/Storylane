import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParentPicker, type ParentCandidate } from "./story-parent-picker";

const candidates: ParentCandidate[] = [
  { id: "c1", number: 10, title: "Existing epic", isContainer: true },
  { id: "c2", number: 11, title: "Plain story", isContainer: false },
];

describe("ParentPicker", () => {
  it("lists None plus every candidate by number and title", () => {
    render(<ParentPicker idPrefix="detail" value={null} candidates={candidates} onChange={vi.fn()} />);
    const select = screen.getByLabelText("Parent");
    expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "#10 Existing epic" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "#11 Plain story" })).toBeInTheDocument();
    expect(select).toHaveValue("");
  });

  it("picking an already-container target calls onChange immediately, no confirmation", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ParentPicker idPrefix="detail" value={null} candidates={candidates} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Parent"), "c1");

    expect(onChange).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clearing to None calls onChange(null) immediately, no confirmation", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ParentPicker idPrefix="detail" value="c1" candidates={candidates} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Parent"), "");

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("picking a not-yet-container target shows a confirmation before calling onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ParentPicker idPrefix="detail" value={null} candidates={candidates} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Parent"), "c2");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/plain story.*will become an epic/i)).toBeInTheDocument();
  });

  it("confirming the containerize dialog calls onChange with the pending id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ParentPicker idPrefix="detail" value={null} candidates={candidates} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Parent"), "c2");
    await user.click(screen.getByRole("button", { name: /make epic/i }));

    expect(onChange).toHaveBeenCalledWith("c2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("canceling the containerize dialog never calls onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ParentPicker idPrefix="detail" value={null} candidates={candidates} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Parent"), "c2");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
