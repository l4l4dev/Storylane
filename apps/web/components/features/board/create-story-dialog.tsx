"use client";

import { useState } from "react";
import { createStory } from "@/app/projects/[id]/board/actions";
import { STORY_TYPES, storyTypeUsesPoints } from "@/lib/utils/stories";

type Option = { id: string; name: string };

export function CreateStoryDialog({
  projectId,
  epics,
  labels,
  members,
}: {
  projectId: string;
  epics: Option[];
  labels: Option[];
  members: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [storyType, setStoryType] = useState<string>("feature");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        New story
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">New story</h2>
            <form
              action={createStory}
              onSubmit={() => setOpen(false)}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="project_id" value={projectId} />

              <label className="flex flex-col gap-1 text-sm">
                <span>Title</span>
                <input
                  name="title"
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

              <div className="flex gap-4">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span>Type</span>
                  <select
                    name="story_type"
                    value={storyType}
                    onChange={(e) => setStoryType(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                  >
                    {STORY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex w-24 flex-col gap-1 text-sm">
                  <span>Points</span>
                  <input
                    name="points"
                    type="number"
                    min={0}
                    disabled={!storyTypeUsesPoints(storyType)}
                    placeholder={storyTypeUsesPoints(storyType) ? "" : "—"}
                    className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-50 dark:border-gray-700 dark:bg-zinc-800"
                  />
                </label>
              </div>

              <div className="flex gap-4">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span>Epic</span>
                  <select
                    name="epic_id"
                    className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                  >
                    <option value="">None</option>
                    {epics.map((epic) => (
                      <option key={epic.id} value={epic.id}>
                        {epic.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span>Assignee</span>
                  <select
                    name="assignee_id"
                    className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {labels.length > 0 && (
                <fieldset className="flex flex-col gap-1 text-sm">
                  <span>Labels</span>
                  <div className="flex flex-wrap gap-2">
                    {labels.map((label) => (
                      <label key={label.id} className="flex items-center gap-1">
                        <input type="checkbox" name="label_ids" value={label.id} />
                        {label.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

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
