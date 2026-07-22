"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MoreVertical } from "lucide-react";
import {
  copyStoryToProject,
  deleteStory,
  getMoveTargetProjects,
  moveStoryToProject,
  promoteStoryToEpic,
  type MoveCopyTargetProject,
  type StoryDetail,
} from "@/app/stories/[id]/actions";
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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

// The peek header's overflow (⋯) menu (spec/screens.md "Story detail
// editing"): hosts Promote to Epic and Delete. Each dialog's open state is
// owned here, outside the DropdownMenu tree — nesting a DialogTrigger inside
// a DropdownMenuItem would unmount the dialog the instant the menu closes.
export function StoryPeekMenu({ detail }: { detail: StoryDetail }) {
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

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
              setMoveOpen(true);
            }}
          >
            Move to project…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCopyOpen(true);
            }}
          >
            Copy to project…
          </DropdownMenuItem>
          {/* TASK-147: hidden for the hidden personal project — promote_story_to_epic
              itself also rejects is_personal server-side (the DELETE it does
              would cascade-lose my_work_story_state + story_completions). */}
          {!detail.isPersonalProject && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setPromoteOpen(true);
              }}
            >
              Promote to Epic
            </DropdownMenuItem>
          )}
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
      <MoveCopyDialog detail={detail} mode="move" open={moveOpen} onOpenChange={setMoveOpen} />
      <MoveCopyDialog detail={detail} mode="copy" open={copyOpen} onOpenChange={setCopyOpen} />
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskCount = detail.tasks.length;
  const commentCount = detail.comments.length;

  // Resets stale state on reopen (TASK-121, doc-13 finding #13) — otherwise a
  // failed attempt's error stayed visible the next time this dialog opened,
  // even for an unrelated later attempt. React's "adjusting state when a prop
  // changes" pattern (during render, not a useEffect — this dialog's `open`
  // is flipped from outside, not via its own trigger, so there's no local
  // event handler to hook the transition into either).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setPending(false);
    }
  }

  async function handlePromote() {
    setPending(true);
    setError(null);
    const result = await promoteStoryToEpic(detail.id);
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    // Promotion removes the source story, so both entry points return to the
    // board. Preserve active board filters when promotion starts from its peek.
    const boardPath = `/projects/${detail.projectId}/board`;
    const params = pathname === boardPath ? new URLSearchParams(searchParams) : new URLSearchParams();
    params.delete("story");
    params.set("promoted_epic", result.epicId);
    params.set("promoted_epic_name", detail.title);
    router.push(`${boardPath}?${params.toString()}`);
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

function MoveCopyDialog({
  detail,
  mode,
  open,
  onOpenChange,
}: {
  detail: StoryDetail;
  mode: "move" | "copy";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<MoveCopyTargetProject[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commentCount = detail.comments.length;

  useEffect(() => {
    if (!open) return;
    async function loadTargets() {
      const result = await getMoveTargetProjects(detail.projectId);
      setError(null);
      setProjects(result);
      setTargetId(result[0]?.id ?? "");
    }
    void loadTargets();
  }, [open, detail.projectId]);

  async function handleSubmit() {
    if (!targetId) return;
    setPending(true);
    setError(null);
    const action = mode === "move" ? moveStoryToProject : copyStoryToProject;
    const result = await action(detail.id, targetId);
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    router.push(`/projects/${result.projectId}/board?story=${result.storyId}`);
  }

  const verb = mode === "move" ? "Move" : "Copy";
  const carryOverNoun = commentCount > 0 ? "tasks and comments" : "tasks";
  // Built as a single JS string rather than inline JSX text: JSX collapses
  // whitespace around embedded expressions in ways that swallowed the space
  // before "move"/"labels" here, so this sidesteps that entirely.
  const description =
    mode === "move"
      ? `“${detail.title}” and its ${carryOverNoun} move to the target project — labels are recreated there by name. It lands unscheduled (Icebox) or in the leftmost column, with a new number. The epic/iteration link is dropped; points are kept only if they exist in the target's point scale; the assignee is kept only if they're a member there. The original is then deleted.`
      : `A duplicate of “${detail.title}” (title, description, type, tasks, labels — no comments or history) is created in the target project, landing unscheduled (Icebox) or in the leftmost column. The original is left untouched.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{verb} to another project</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="move-copy-target">Target project</Label>
          {projects && projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You&apos;re not an owner or member of any other project.
            </p>
          ) : (
            <NativeSelect
              id="move-copy-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={!projects}
            >
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={pending || !targetId}
          >
            {pending ? `${verb === "Move" ? "Moving" : "Copying"}…` : `${verb} story`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
