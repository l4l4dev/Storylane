import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskChecklist } from "./task-checklist";

describe("TaskChecklist", () => {
  it("shows an empty state when there are no tasks", () => {
    render(<TaskChecklist storyId="s1" tasks={[]} />);
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
  });

  it("renders the done/total count", () => {
    render(
      <TaskChecklist
        storyId="s1"
        tasks={[
          { id: "t1", title: "Write tests", is_done: true },
          { id: "t2", title: "Ship it", is_done: false },
        ]}
      />,
    );
    expect(screen.getByText("(1/2)")).toBeInTheDocument();
  });

  it("renders a done task with a strikethrough and the checked toggle", () => {
    render(<TaskChecklist storyId="s1" tasks={[{ id: "t1", title: "Write tests", is_done: true }]} />);
    expect(screen.getByText("Write tests")).toHaveClass("line-through");
    // A done task's toggle renders in the brand color; the aria-label reflects
    // the action (toggling it back to not-done).
    expect(screen.getByLabelText('Mark "Write tests" as not done')).toHaveClass("text-primary");
  });

  it("renders a pending task with no strikethrough and the unchecked toggle", () => {
    render(<TaskChecklist storyId="s1" tasks={[{ id: "t1", title: "Ship it", is_done: false }]} />);
    expect(screen.getByText("Ship it")).not.toHaveClass("line-through");
    expect(screen.getByLabelText('Mark "Ship it" as done')).toHaveClass("text-muted-foreground");
  });

  it("exposes a delete button for each task", () => {
    render(<TaskChecklist storyId="s1" tasks={[{ id: "t1", title: "Ship it", is_done: false }]} />);
    expect(screen.getByLabelText('Delete task "Ship it"')).toBeInTheDocument();
  });
});
