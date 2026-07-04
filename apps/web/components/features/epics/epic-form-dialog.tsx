"use client";

import { useState } from "react";
import { createEpic, updateEpic } from "@/app/projects/[id]/epics/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit epic" : "New epic"}</DialogTitle>
        </DialogHeader>

        <form action={action} onSubmit={() => setOpen(false)} className="flex flex-col gap-4">
          <input type="hidden" name="project_id" value={projectId} />
          {isEdit && <input type="hidden" name="epic_id" value={epic.id} />}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="epic-name">Name</Label>
            <Input id="epic-name" name="name" required autoFocus defaultValue={epic?.name} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="epic-description">Description</Label>
            <Textarea
              id="epic-description"
              name="description"
              rows={2}
              defaultValue={epic?.description ?? ""}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="epic-color">Color</Label>
            <input
              id="epic-color"
              name="color"
              type="color"
              defaultValue={epic?.color ?? "#6366f1"}
              className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
