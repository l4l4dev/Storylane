"use client";

import { Square, SquareCheck, X } from "lucide-react";
import { addTask, deleteTask, toggleTask } from "@/app/stories/[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TaskData = { id: string; title: string; is_done: boolean };

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

  async function handleAdd(formData: FormData) {
    await addTask(formData);
    await onMutated?.();
  }

  async function handleToggle(formData: FormData) {
    await toggleTask(formData);
    await onMutated?.();
  }

  async function handleDelete(formData: FormData) {
    await deleteTask(formData);
    await onMutated?.();
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

      {tasks.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <form action={handleToggle} className="flex">
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="story_id" value={storyId} />
                <input type="hidden" name="is_done" value={String(task.is_done)} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    task.is_done
                      ? `Mark "${task.title}" as not done`
                      : `Mark "${task.title}" as done`
                  }
                  className={task.is_done ? "text-primary" : "text-muted-foreground"}
                >
                  {task.is_done ? <SquareCheck /> : <Square />}
                </Button>
              </form>
              <span
                className={`flex-1 text-sm ${task.is_done ? "text-muted-foreground line-through" : ""}`}
              >
                {task.title}
              </span>
              <form action={handleDelete} className="flex">
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="story_id" value={storyId} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete task "${task.title}"`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">No tasks yet.</p>
      )}

      <form action={handleAdd} className="flex gap-2">
        <input type="hidden" name="story_id" value={storyId} />
        <Input name="title" required placeholder="Add a task…" className="flex-1" />
        <Button type="submit">Add</Button>
      </form>
    </section>
  );
}
