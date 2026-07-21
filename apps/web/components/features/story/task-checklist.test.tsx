import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/types";
import { TaskChecklist } from "./task-checklist";

const { addTaskMock, toggleTaskMock, deleteTaskMock } = vi.hoisted(() => ({
  addTaskMock: vi.fn<(formData: FormData) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
  toggleTaskMock: vi.fn<(formData: FormData) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
  deleteTaskMock: vi.fn<(formData: FormData) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
}));

vi.mock("@/app/stories/[id]/actions", () => ({
  addTask: addTaskMock,
  toggleTask: toggleTaskMock,
  deleteTask: deleteTaskMock,
}));

describe("TaskChecklist", () => {
  beforeEach(() => {
    addTaskMock.mockReset();
    addTaskMock.mockResolvedValue({ ok: true });
    toggleTaskMock.mockReset();
    toggleTaskMock.mockResolvedValue({ ok: true });
    deleteTaskMock.mockReset();
    deleteTaskMock.mockResolvedValue({ ok: true });
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
    let resolveToggle!: (result: ActionResult) => void;
    toggleTaskMock.mockReturnValueOnce(
      new Promise<ActionResult>((resolve) => {
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
      resolveToggle({ ok: true });
      await Promise.resolve();
    });
    expect(toggle).toBeEnabled();
  });

  // TASK-119: pendingKeys must be scoped per-task — a shared single key let
  // starting an action on task B re-enable task A's still-in-flight control.
  it("keeps task A's Delete disabled while pending, even after starting an action on task B", async () => {
    let resolveDeleteA!: (result: ActionResult) => void;
    deleteTaskMock.mockReturnValueOnce(
      new Promise<ActionResult>((resolve) => {
        resolveDeleteA = resolve;
      }),
    );
    render(
      <TaskChecklist
        storyId="s1"
        tasks={[
          { id: "a", title: "Task A", is_done: false },
          { id: "b", title: "Task B", is_done: false },
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText('Delete task "Task A"'));
    expect(screen.getByLabelText('Delete task "Task A"')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Mark "Task B" as done'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Delete task "Task A"')).toBeDisabled();
    expect(deleteTaskMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Delete task "Task A"'));
    expect(deleteTaskMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDeleteA({ ok: true });
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Delete task "Task A"')).toBeEnabled();
  });

  // TASK-74: a rejected mutation used to throw into the route error
  // boundary instead of staying inline.
  it("shows a failed toggle result inline instead of throwing", async () => {
    toggleTaskMock.mockResolvedValueOnce({ ok: false, message: "Task not found" });
    render(<TaskChecklist storyId="s1" tasks={[{ id: "t1", title: "Ship it", is_done: false }]} />);
    fireEvent.click(screen.getByLabelText('Mark "Ship it" as done'));

    expect(await screen.findByRole("alert")).toHaveTextContent("Task not found");
    expect(screen.getByLabelText('Mark "Ship it" as done')).toBeEnabled();
  });

  it("shows a failed delete result inline and keeps the task", async () => {
    deleteTaskMock.mockResolvedValueOnce({ ok: false, message: "Task not found" });
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

    addTaskMock.mockResolvedValueOnce({ ok: false, message: "Failed to add task" });
    fireEvent.change(input, { target: { value: "Second task" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to add task");
    expect(input).toHaveValue("Second task");
  });
});
