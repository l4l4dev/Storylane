"use client";

import { useState } from "react";
import { createProject } from "@/app/dashboard/actions";
import { ITERATION_LENGTHS, POINT_SCALES } from "@/lib/types";

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        New project
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">New project</h2>
            <form action={createProject} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span>Name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Description</span>
                <textarea
                  name="description"
                  rows={2}
                  className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Iteration length (days)</span>
                <select
                  name="iteration_length"
                  defaultValue={14}
                  className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                >
                  {ITERATION_LENGTHS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Point scale</span>
                <select
                  name="point_scale"
                  defaultValue="fibonacci"
                  className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                >
                  {POINT_SCALES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
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
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
