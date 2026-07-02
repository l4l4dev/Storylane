"use client";

import { useState } from "react";
import { createEpic, updateEpic } from "@/app/projects/[id]/epics/actions";

type EpicFormValues = {
  id: string;
  name: string;
  description: string | null;
  color: string;
};

export function EpicFormDialog({
  projectId,
  epic,
  trigger,
}: {
  projectId: string;
  epic?: EpicFormValues;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = epic != null;
  const action = isEdit ? updateEpic : createEpic;

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">{isEdit ? "Edit epic" : "New epic"}</h2>
            <form
              action={action}
              onSubmit={() => setOpen(false)}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="project_id" value={projectId} />
              {isEdit && <input type="hidden" name="epic_id" value={epic.id} />}

              <label className="flex flex-col gap-1 text-sm">
                <span>Name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={epic?.name}
                  className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Description</span>
                <textarea
                  name="description"
                  rows={2}
                  defaultValue={epic?.description ?? ""}
                  className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                />
              </label>

              <label className="flex items-center gap-3 text-sm">
                <span>Color</span>
                <input
                  name="color"
                  type="color"
                  defaultValue={epic?.color ?? "#6366f1"}
                  className="h-9 w-14 cursor-pointer rounded-md border border-gray-300 dark:border-gray-700"
                />
              </label>

              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  {isEdit ? "Save changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
