import { createCustomStatus, deleteCustomStatus, moveCustomStatus, updateCustomStatus } from "@/app/projects/[id]/settings/actions";
import { ReorderableListManager } from "./reorderable-list-manager";

export type CustomStatusRow = { id: string; name: string; color: string; position: number; is_done: boolean };

export function StatusManager({ projectId, statuses, canEdit, canDelete }: { projectId: string; statuses: CustomStatusRow[]; canEdit: boolean; canDelete: boolean }) {
  return (
    <ReorderableListManager
      projectId={projectId}
      items={statuses}
      canEdit={canEdit}
      canDelete={canDelete}
      itemName="status"
      createAction={createCustomStatus}
      updateAction={updateCustomStatus}
      moveAction={moveCustomStatus}
      deleteAction={deleteCustomStatus}
      newNamePlaceholder="New status name"
      renderFields={(status, editable, nameField) => (
        <>
          <input type="color" name="color" defaultValue={status?.color ?? "#6b7280"} aria-label={status ? `Color for ${status.name}` : "New status color"} disabled={status ? !editable : false} className="size-8 shrink-0 cursor-pointer rounded border border-border bg-transparent" />
          {nameField}
          {status && <label className="flex shrink-0 items-center gap-1.5 text-sm" title="Counts as done in reports"><input type="checkbox" name="is_done" defaultChecked={status.is_done} disabled={!editable} />Done</label>}
        </>
      )}
    />
  );
}
