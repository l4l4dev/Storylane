"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { deleteStory, promoteStoryToEpic, type StoryDetail } from "@/app/stories/[id]/actions";
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

// The peek header's overflow (⋯) menu (spec/screens.md "Story detail
// editing"): hosts Promote to Epic and Delete. Each dialog's open state is
// owned here, outside the DropdownMenu tree — nesting a DialogTrigger inside
// a DropdownMenuItem would unmount the dialog the instant the menu closes.
export function StoryPeekMenu({ detail }: { detail: StoryDetail }) {
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Story actions">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setPromoteOpen(true);
            }}
          >
            Promote to Epic
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            Delete story
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PromoteToEpicDialog detail={detail} open={promoteOpen} onOpenChange={setPromoteOpen} />
      <DeleteStoryDialog detail={detail} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}

function PromoteToEpicDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: StoryDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskCount = detail.tasks.length;
  const commentCount = detail.comments.length;

  async function handlePromote() {
    setPending(true);
    setError(null);
    const result = await promoteStoryToEpic(detail.id);
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    router.push(`/projects/${detail.projectId}/epics`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote to epic?</DialogTitle>
          <DialogDescription>
            &ldquo;{detail.title}&rdquo; becomes a new epic.{" "}
            {taskCount > 0
              ? `Its ${taskCount} task${taskCount === 1 ? "" : "s"} become unestimated feature ${taskCount === 1 ? "story" : "stories"} linked to the new epic, in order — task completion state isn't carried over.`
              : "It has no tasks, so the epic starts empty."}{" "}
            Points and assignee are discarded. This story is then deleted
            {commentCount > 0
              ? ` — including its ${commentCount} comment${commentCount === 1 ? "" : "s"}, which cannot be recovered.`
              : "."}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handlePromote()} disabled={pending}>
            {pending ? "Promoting…" : "Promote to epic"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStoryDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: StoryDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const commentCount = detail.comments.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this story?</DialogTitle>
          <DialogDescription>
            &ldquo;{detail.title}&rdquo; will be permanently deleted
            {commentCount > 0
              ? `, including its ${commentCount} comment${commentCount === 1 ? "" : "s"}.`
              : "."}{" "}
            This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        <form action={deleteStory}>
          <input type="hidden" name="story_id" value={detail.id} />
          <input type="hidden" name="project_id" value={detail.projectId} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive">
              Delete story
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
