import { ArrowDown, ArrowUp } from "lucide-react";
import {
  createCustomStatus,
  deleteCustomStatus,
  moveCustomStatus,
  updateCustomStatus,
} from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type CustomStatusRow = { id: string; name: string; color: string; position: number; is_done: boolean };

// Board-column management for free-mode projects — rename, color,
// "counts as done" flag, one-step reorder, delete (blocked by the DB while
// stories still reference the status), and an add row at the bottom. Plain
// forms + server actions, so this stays a Server Component.
export function StatusManager({
  projectId,
  statuses,
  canEdit,
  canDelete,
}: {
  projectId: string;
  statuses: CustomStatusRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {statuses.map((status, index) => (
          <li key={status.id} className="flex items-center gap-2">
            <form action={moveCustomStatus} className="flex gap-0.5">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="status_id" value={status.id} />
              <Button
                type="submit"
                name="direction"
                value="up"
                variant="ghost"
                size="icon-xs"
                disabled={!canEdit || index === 0}
                aria-label={`Move ${status.name} up`}
              >
                <ArrowUp />
              </Button>
              <Button
                type="submit"
                name="direction"
                value="down"
                variant="ghost"
                size="icon-xs"
                disabled={!canEdit || index === statuses.length - 1}
                aria-label={`Move ${status.name} down`}
              >
                <ArrowDown />
              </Button>
            </form>

            <form action={updateCustomStatus} className="flex flex-1 items-center gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="status_id" value={status.id} />
              <input
                type="color"
                name="color"
                defaultValue={status.color}
                aria-label={`Color for ${status.name}`}
                disabled={!canEdit}
                className="size-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              />
              <Input name="name" defaultValue={status.name} required disabled={!canEdit} className="h-8" />
              <label className="flex shrink-0 items-center gap-1.5 text-sm" title="Counts as done in reports">
                <input type="checkbox" name="is_done" defaultChecked={status.is_done} disabled={!canEdit} />
                Done
              </label>
              {canEdit && (
                <Button type="submit" variant="outline" size="sm">
                  Save
                </Button>
              )}
            </form>

            {canDelete && (
              <form action={deleteCustomStatus}>
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="status_id" value={status.id} />
                <Button type="submit" variant="destructive" size="sm">
                  Delete
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <form action={createCustomStatus} className="flex items-center gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input
            type="color"
            name="color"
            defaultValue="#6b7280"
            aria-label="New status color"
            className="size-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
          />
          <Input name="name" placeholder="New status name" required className="h-8" />
          <Button type="submit" variant="outline" size="sm">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
