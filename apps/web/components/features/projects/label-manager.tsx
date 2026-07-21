"use client";

import { useActionState } from "react";
import { X } from "lucide-react";
import { createLabel, deleteLabel, type LabelActionState } from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [state, formAction] = useActionState<LabelActionState, FormData>(createLabel, {});
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
              <form action={deleteLabel} className="flex">
                <input type="hidden" name="label_id" value={label.id} />
                <input type="hidden" name="project_id" value={projectId} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete label ${label.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X />
                </Button>
              </form>
            )}
          </li>
        ))}
        {labels.length === 0 && <li className="text-sm text-muted-foreground">No labels yet.</li>}
      </ul>

      {canCreate && (
        <form action={formAction} className="flex flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-label-name">New label</Label>
              <Input id="new-label-name" name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-label-color">Color</Label>
              <input
                id="new-label-color"
                name="color"
                type="color"
                defaultValue="#6b7280"
                className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent"
              />
            </div>
            <Button type="submit" variant="outline">
              Add
            </Button>
          </div>
          {state.error && <span className="text-xs text-destructive">{state.error}</span>}
        </form>
      )}
    </div>
  );
}
