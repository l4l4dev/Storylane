import { createLane, deleteLane, moveLane, updateLane } from "@/app/projects/[id]/settings/actions";
import { ReorderableListManager } from "./reorderable-list-manager";

export type SwimlaneRow = { id: string; name: string; position: number };

export function LaneManager({ projectId, lanes, canEdit, canDelete }: { projectId: string; lanes: SwimlaneRow[]; canEdit: boolean; canDelete: boolean }) {
  return (
    <ReorderableListManager
      projectId={projectId}
      items={lanes}
      canEdit={canEdit}
      canDelete={canDelete}
      itemName="lane"
      createAction={createLane}
      updateAction={updateLane}
      moveAction={moveLane}
      deleteAction={deleteLane}
      newNamePlaceholder="New lane name"
      renderFields={(_lane, _editable, nameField) => nameField}
    />
  );
}
