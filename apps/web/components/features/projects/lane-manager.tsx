import { ArrowDown, ArrowUp } from "lucide-react";
import { createLane, deleteLane, moveLane, updateLane } from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SwimlaneRow = { id: string; name: string; position: number };

// TASK-16.3: swimlane management for free-mode projects — rename, one-step
// reorder, delete (blocked by the DB while stories still reference the
// lane), and an add row at the bottom. Mirrors StatusManager, minus the
// color/is_done fields lanes don't have.
export function LaneManager({
  projectId,
  lanes,
  canEdit,
  canDelete,
}: {
  projectId: string;
  lanes: SwimlaneRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {lanes.map((lane, index) => (
          <li key={lane.id} className="flex items-center gap-2">
            <form action={moveLane} className="flex gap-0.5">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="lane_id" value={lane.id} />
              <Button
                type="submit"
                name="direction"
                value="up"
                variant="ghost"
                size="icon-xs"
                disabled={!canEdit || index === 0}
                aria-label={`Move ${lane.name} up`}
              >
                <ArrowUp />
              </Button>
              <Button
                type="submit"
                name="direction"
                value="down"
                variant="ghost"
                size="icon-xs"
                disabled={!canEdit || index === lanes.length - 1}
                aria-label={`Move ${lane.name} down`}
              >
                <ArrowDown />
              </Button>
            </form>

            <form action={updateLane} className="flex flex-1 items-center gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="lane_id" value={lane.id} />
              <Input name="name" defaultValue={lane.name} required disabled={!canEdit} className="h-8" />
              {canEdit && (
                <Button type="submit" variant="outline" size="sm">
                  Save
                </Button>
              )}
            </form>

            {canDelete && (
              <form action={deleteLane}>
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="lane_id" value={lane.id} />
                <Button type="submit" variant="destructive" size="sm">
                  Delete
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <form action={createLane} className="flex items-center gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <Input name="name" placeholder="New lane name" required className="h-8" />
          <Button type="submit" variant="outline" size="sm">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
