import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskChecklist } from "./task-checklist";

const { addTaskMock, toggleTaskMock, deleteTaskMock } = vi.hoisted(() => ({
  addTaskMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  toggleTaskMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  deleteTaskMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/stories/[id]/actions", () => ({
  addTask: addTaskMock,
  toggleTask: toggleTaskMock,
  deleteTask: deleteTaskMock,
}));

describe("TaskChecklist", () => {
  beforeEach(() => {
    addTaskMock.mockReset();
    addTaskMock.mockResolvedValue(undefined);
    toggleTaskMock.mockReset();
    toggleTaskMock.mockResolvedValue(undefined);
    deleteTaskMock.mockReset();
    deleteTaskMock.mockResolvedValue(undefined);
  });

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

  // TASK-74: a bare <form action> had no pending state, so a double-click
  // fired the toggle twice — the clicked control must disable itself.
  it("disables the toggle while pending so a double-click only submits once", async () => {
    let resolveToggle!: () => void;
    toggleTaskMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveToggle = resolve;
      }),
    );
    render(<TaskChecklist storyId="s1" tasks={[{ id: "t1", title: "Ship it", is_done: false }]} />);
    const toggle = screen.getByLabelText('Mark "Ship it" as done');
    fireEvent.click(toggle);
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);

    expect(toggleTaskMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveToggle();
      await Promise.resolve();
    });
    expect(toggle).toBeEnabled();
  });

  // TASK-74: a rejected mutation used to throw into the route error
  // boundary instead of staying inline.
  it("shows a rejected toggle inline instead of throwing", async () => {
    toggleTaskMock.mockRejectedValueOnce(new Error("Task not found"));
    render(<TaskChecklist storyId="s1" tasks={[{ id: "t1", title: "Ship it", is_done: false }]} />);
    fireEvent.click(screen.getByLabelText('Mark "Ship it" as done'));

    expect(await screen.findByRole("alert")).toHaveTextContent("Task not found");
    expect(screen.getByLabelText('Mark "Ship it" as done')).toBeEnabled();
  });

  it("shows a rejected delete inline and keeps the task", async () => {
    deleteTaskMock.mockRejectedValueOnce(new Error("Task not found"));
    render(<TaskChecklist storyId="s1" tasks={[{ id: "t1", title: "Ship it", is_done: false }]} />);
    fireEvent.click(screen.getByLabelText('Delete task "Ship it"'));

    expect(await screen.findByRole("alert")).toHaveTextContent("Task not found");
    expect(screen.getByText("Ship it")).toBeInTheDocument();
  });

  it("adds a task, clears the input, and keeps the typed title when creation fails", async () => {
    render(<TaskChecklist storyId="s1" tasks={[]} />);
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Write docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(addTaskMock).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");

    addTaskMock.mockRejectedValueOnce(new Error("Failed to add task"));
    fireEvent.change(input, { target: { value: "Second task" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to add task");
    expect(input).toHaveValue("Second task");
  });
});
