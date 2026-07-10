"use client";

import { useState } from "react";
import { MoreVertical, Star } from "lucide-react";
import { archiveProject, toggleFavorite, unarchiveProject } from "@/app/dashboard/actions";
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
import { cn } from "@/lib/utils";

// TASK-8 (spec/screens.md "Projects page"): ProjectCard's interactive
// bits, split into their own client component so ProjectCard itself stays
// a Server Component (matches the InlineCreatePanel/ProjectCard split
// from TASK-7).
export function ProjectCardMenu({
  projectId,
  projectName,
  isOwner,
  isFavorite,
  isArchived,
}: {
  projectId: string;
  projectName: string;
  isOwner: boolean;
  isFavorite: boolean;
  isArchived: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [favorite, setFavorite] = useState(isFavorite);
  const [pending, setPending] = useState(false);

  async function handleToggleFavorite() {
    if (pending) {
      return;
    }
    setPending(true);
    const next = !favorite;
    setFavorite(next);
    const result = await toggleFavorite(projectId, next);
    setPending(false);
    if (!result.ok) {
      setFavorite(!next);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => void handleToggleFavorite()}
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={favorite}
        className="text-muted-foreground hover:text-foreground"
      >
        <Star className={cn("size-4", favorite && "fill-current text-primary")} />
      </button>

      {isOwner && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Project actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmOpen(true);
                }}
              >
                {isArchived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{isArchived ? "Unarchive this project?" : "Archive this project?"}</DialogTitle>
                <DialogDescription>
                  {isArchived
                    ? `"${projectName}" becomes active again and reappears on the main Projects list.`
                    : `"${projectName}" is hidden from the main Projects list until unarchived. This can be undone.`}
                </DialogDescription>
              </DialogHeader>
              <form action={isArchived ? unarchiveProject : archiveProject} onSubmit={() => setConfirmOpen(false)}>
                <input type="hidden" name="project_id" value={projectId} />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant={isArchived ? "default" : "destructive"}>
                    {isArchived ? "Unarchive" : "Archive"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
