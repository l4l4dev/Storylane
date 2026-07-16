import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ManagerRow = { id: string; name: string };
type FormAction = (formData: FormData) => void | Promise<void>;

export function ReorderableListManager<T extends ManagerRow>({
  projectId,
  items,
  canEdit,
  canDelete,
  itemName,
  createAction,
  updateAction,
  moveAction,
  deleteAction,
  newNamePlaceholder,
  renderFields,
}: {
  projectId: string;
  items: T[];
  canEdit: boolean;
  canDelete: boolean;
  itemName: string;
  createAction: FormAction;
  updateAction: FormAction;
  moveAction: FormAction;
  deleteAction: FormAction;
  newNamePlaceholder: string;
  renderFields: (item: T | null, canEdit: boolean, nameField: ReactNode) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={item.id} className="flex items-center gap-2">
            <form action={moveAction} className="flex gap-0.5">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name={`${itemName}_id`} value={item.id} />
              <Button type="submit" name="direction" value="up" variant="ghost" size="icon-xs" disabled={!canEdit || index === 0} aria-label={`Move ${item.name} up`}><ArrowUp /></Button>
              <Button type="submit" name="direction" value="down" variant="ghost" size="icon-xs" disabled={!canEdit || index === items.length - 1} aria-label={`Move ${item.name} down`}><ArrowDown /></Button>
            </form>
            <form action={updateAction} className="flex flex-1 items-center gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name={`${itemName}_id`} value={item.id} />
              {renderFields(item, canEdit, <Input name="name" defaultValue={item.name} required disabled={!canEdit} className="h-8" />)}
              {canEdit && <Button type="submit" variant="outline" size="sm">Save</Button>}
            </form>
            {canDelete && (
              <form action={deleteAction}>
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name={`${itemName}_id`} value={item.id} />
                <Button type="submit" variant="destructive" size="sm">Delete</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form action={createAction} className="flex items-center gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          {renderFields(null, canEdit, <Input name="name" placeholder={newNamePlaceholder} required className="h-8" />)}
          <Button type="submit" variant="outline" size="sm">Add</Button>
        </form>
      )}
    </div>
  );
}
