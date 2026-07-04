"use client";

import { addTask, deleteTask, toggleTask } from "@/app/stories/[id]/actions";

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
    <section className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">
      <h2 className="mb-3 text-lg font-semibold">
        Tasks
        {tasks.length > 0 && (
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({doneCount}/{tasks.length})
          </span>
        )}
      </h2>

      {tasks.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <form action={handleToggle}>
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="story_id" value={storyId} />
                <input type="hidden" name="is_done" value={String(task.is_done)} />
                <button
                  type="submit"
                  aria-label={task.is_done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
                  className="text-base leading-none"
                >
                  {task.is_done ? "☑" : "☐"}
                </button>
              </form>
              <span className={`flex-1 text-sm ${task.is_done ? "text-gray-400 line-through" : ""}`}>
                {task.title}
              </span>
              <form action={handleDelete}>
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="story_id" value={storyId} />
                <button
                  type="submit"
                  aria-label={`Delete task "${task.title}"`}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-gray-500">No tasks yet.</p>
      )}

      <form action={handleAdd} className="flex gap-2">
        <input type="hidden" name="story_id" value={storyId} />
        <input
          name="title"
          required
          placeholder="Add a task…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-zinc-800"
        />
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Add
        </button>
      </form>
    </section>
  );
}
