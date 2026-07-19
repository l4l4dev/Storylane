"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Square, SquareCheck, X } from "lucide-react";
import { addTask, deleteTask, toggleTask } from "@/app/stories/[id]/actions";
import type { ActionResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TaskData = { id: string; title: string; is_done: boolean };

// Each control disables itself while its own request is in flight; one shared
// inline error covers the section. Server Actions return failures as values
// so production error masking cannot replace that message.
export function TaskChecklist({
  storyId,
  tasks,
  onMutated,
}: {
  storyId: string;
  tasks: TaskData[];
  // Set only by the board's inline expansion (see story-detail-panel.tsx):
  // that view's task list is fetched once into local state, so it needs an
  // explicit refetch after each mutation. The standalone `/stories/[id]`
  // page omits it and relies on the normal server-action revalidation.
  onMutated?: () => Promise<void> | void;
}) {
  const doneCount = tasks.filter((task) => task.is_done).length;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");

  function run(key: string, action: () => Promise<ActionResult>) {
    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          await onMutated?.();
        } else {
          setError(result.message);
        }
      } catch {
        setError("Failed to update tasks");
      } finally {
        setPendingKey(null);
      }
    });
  }

  function handleToggle(task: TaskData) {
    const formData = new FormData();
    formData.set("task_id", task.id);
    formData.set("story_id", storyId);
    formData.set("is_done", String(task.is_done));
    run(`toggle:${task.id}`, () => toggleTask(formData));
  }

  function handleDelete(task: TaskData) {
    const formData = new FormData();
    formData.set("task_id", task.id);
    formData.set("story_id", storyId);
    run(`delete:${task.id}`, () => deleteTask(formData));
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed) {
      return;
    }
    const formData = new FormData();
    formData.set("story_id", storyId);
    formData.set("title", trimmed);
    run("add", async () => {
      const result = await addTask(formData);
      if (result.ok) {
        setNewTitle("");
      }
      return result;
    });
  }

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h2 className="mb-3 text-lg font-semibold">
        Tasks
        {tasks.length > 0 && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({doneCount}/{tasks.length})
          </span>
        )}
      </h2>

      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {tasks.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={
                  task.is_done
                    ? `Mark "${task.title}" as not done`
                    : `Mark "${task.title}" as done`
                }
                className={task.is_done ? "text-primary" : "text-muted-foreground"}
                disabled={isPending && pendingKey === `toggle:${task.id}`}
                onClick={() => handleToggle(task)}
              >
                {task.is_done ? <SquareCheck /> : <Square />}
              </Button>
              <span
                className={`flex-1 text-sm ${task.is_done ? "text-muted-foreground line-through" : ""}`}
              >
                {task.title}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete task "${task.title}"`}
                className="text-muted-foreground hover:text-destructive"
                disabled={isPending && pendingKey === `delete:${task.id}`}
                onClick={() => handleDelete(task)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">No tasks yet.</p>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          required
          placeholder="Add a task…"
          className="flex-1"
          disabled={isPending && pendingKey === "add"}
        />
        <Button type="submit" disabled={isPending && pendingKey === "add"}>
          Add
        </Button>
      </form>
    </section>
  );
}
