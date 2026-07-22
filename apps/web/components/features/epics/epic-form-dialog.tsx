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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = epic != null;
  const action = isEdit ? updateEpic : createEpic;

  // Closes only after the server action resolves successfully (TASK-122,
  // doc-13 finding #14) — the dialog used to close synchronously on submit
  // via the native <form action> + onSubmit combo, so an empty/whitespace-only
  // name (which the actions silently no-op'd on) still looked like a save.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await action(new FormData(event.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit epic" : "New epic"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <input type="hidden" name="project_id" value={projectId} />
          {isEdit && <input type="hidden" name="epic_id" value={epic.id} />}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="epic-name">Name</Label>
            <Input id="epic-name" name="name" required autoFocus defaultValue={epic?.name} disabled={pending} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="epic-description">Description</Label>
            <Textarea
              id="epic-description"
              name="description"
              rows={2}
              defaultValue={epic?.description ?? ""}
              disabled={pending}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="epic-color">Color</Label>
            <input
              id="epic-color"
              name="color"
              type="color"
              defaultValue={epic?.color ?? "#6366f1"}
              disabled={pending}
              className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
