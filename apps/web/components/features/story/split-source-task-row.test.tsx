import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitSourceTaskRow } from "./split-source-task-row";

const task = { id: "t1", title: "Write the migration", is_done: false };

describe("SplitSourceTaskRow", () => {
  it("shows just the title when unassigned", () => {
    render(<SplitSourceTaskRow task={task} />);
    expect(screen.getByText("Write the migration")).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  // fable-advisor: with several tasks, an already-assigned one must read
  // differently from one still needing a home, or the user loses track of
  // what's left to sort while dragging.
  it("shows the assigned child's title and dims the row once assigned", () => {
    render(<SplitSourceTaskRow task={task} assignedToTitle="Handle offline mode" />);
    expect(screen.getByText(/Write the migration/)).toBeInTheDocument();
    expect(screen.getByText(/→ Handle offline mode/)).toBeInTheDocument();
  });

  it("falls back to '(untitled)' when the assigned child has no title yet", () => {
    render(<SplitSourceTaskRow task={task} assignedToTitle="" />);
    expect(screen.getByText(/→ \(untitled\)/)).toBeInTheDocument();
  });
});
