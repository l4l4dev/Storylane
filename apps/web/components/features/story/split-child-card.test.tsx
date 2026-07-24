import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SplitChildCard } from "./split-child-card";
import type { SplitChildDraft } from "@/lib/utils/split-studio";

const baseChild: SplitChildDraft = {
  id: "c1",
  title: "",
  description: "",
  storyType: "feature",
  points: null,
  taskIds: [],
};

describe("SplitChildCard", () => {
  it("renders title, description, type, and points fields", () => {
    render(<SplitChildCard child={baseChild} pointScale={[0, 1, 2, 3]} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Points")).toBeInTheDocument();
  });

  it("does not render an assignee or labels field", () => {
    render(<SplitChildCard child={baseChild} pointScale={[0, 1, 2, 3]} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByLabelText("Assignee")).not.toBeInTheDocument();
    expect(screen.queryByText("Labels")).not.toBeInTheDocument();
  });

  it("calls onChange with the patched field on edit", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SplitChildCard child={baseChild} pointScale={[0, 1, 2, 3]} onChange={onChange} onRemove={vi.fn()} />);

    await user.type(screen.getByLabelText("Title"), "X");
    expect(onChange).toHaveBeenCalledWith({ title: "X" });
  });

  // storyTypeUsesPoints is the app's existing invariant for this (parsePoints,
  // lib/utils/board.ts, lib/utils/iterations.ts all null points for a type
  // that doesn't use them) — Split Studio must not diverge and let a chore
  // child persist a point value split_story silently keeps.
  it("clears points when switched to a story type that doesn't use them", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitChildCard
        child={{ ...baseChild, points: 5 }}
        pointScale={[0, 1, 2, 3, 5]}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Type"), "chore");
    expect(onChange).toHaveBeenCalledWith({ storyType: "chore", points: null });
  });

  it("leaves points untouched when switching between two point-using types", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitChildCard
        child={{ ...baseChild, storyType: "feature", points: 5 }}
        pointScale={[0, 1, 2, 3, 5]}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Type"), "bug");
    expect(onChange).toHaveBeenCalledWith({ storyType: "bug" });
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<SplitChildCard child={baseChild} pointScale={[0, 1, 2, 3]} onChange={vi.fn()} onRemove={onRemove} />);

    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows the reassigned task titles", () => {
    render(
      <SplitChildCard
        child={{ ...baseChild, taskIds: ["t1", "t2"] }}
        pointScale={[0, 1, 2, 3]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        taskTitleById={new Map([["t1", "Fix bug"], ["t2", "Write docs"]])}
      />,
    );
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.getByText("Write docs")).toBeInTheDocument();
  });
});
