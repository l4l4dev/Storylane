"use client";

import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { deleteEpic } from "@/app/projects/[id]/epics/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Delete lives behind the overflow menu, not as a sibling of Edit in the
// primary row (spec/ux-principles.md principle 6) — confirm dialog owns its
// open state outside the DropdownMenu tree, same reason as story-peek-menu.
export function EpicDeleteMenu({ epicId, epicName, projectId }: { epicId: string; epicName: string; projectId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${epicName} actions`}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          >
            Delete epic
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteEpicDialog epicId={epicId} epicName={epicName} projectId={projectId} open={open} onOpenChange={setOpen} />
    </>
  );
}

function DeleteEpicDialog({
  epicId,
  epicName,
  projectId,
  open,
  onOpenChange,
}: {
  epicId: string;
  epicName: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);
    const result = await deleteEpic(epicId, projectId);
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    onOpenChange(false);
    setPending(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this epic?</DialogTitle>
          <DialogDescription>
            &ldquo;{epicName}&rdquo; will be permanently deleted. Its stories are kept but unlinked from the epic.
            This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={pending}>
            {pending ? "Deleting…" : "Delete epic"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
