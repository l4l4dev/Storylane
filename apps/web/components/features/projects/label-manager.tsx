"use client";

import { createLabel, deleteLabel } from "@/app/projects/[id]/settings/actions";

type LabelData = { id: string; name: string; color: string };

export function LabelManager({
  projectId,
  labels,
  canCreate,
  canDelete,
}: {
  projectId: string;
  labels: LabelData[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <li key={label.id} className="flex items-center gap-1">
            <span
              className="rounded px-1.5 py-0.5 text-xs"
              style={{ backgroundColor: `${label.color}22`, color: label.color }}
            >
              {label.name}
            </span>
            {canDelete && (
              <form action={deleteLabel}>
                <input type="hidden" name="label_id" value={label.id} />
                <input type="hidden" name="project_id" value={projectId} />
                <button
                  type="submit"
                  aria-label={`Delete label ${label.name}`}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  ×
                </button>
              </form>
            )}
          </li>
        ))}
        {labels.length === 0 && <li className="text-sm text-gray-500">No labels yet.</li>}
      </ul>

      {canCreate && (
        <form action={createLabel} className="flex items-end gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>New label</span>
            <input
              name="name"
              required
              className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Color</span>
            <input
              name="color"
              type="color"
              defaultValue="#6b7280"
              className="h-9 w-14 cursor-pointer rounded-md border border-gray-300 dark:border-gray-700"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
          >
            Add
          </button>
        </form>
      )}
    </div>
  );
}
