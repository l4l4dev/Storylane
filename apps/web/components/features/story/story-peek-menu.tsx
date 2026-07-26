"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import {
  copyStoryToProject,
  deleteStory,
  getMoveTargetProjects,
  moveStoryToProject,
  turnIntoEpic,
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
// editing"): hosts Split, Move/Copy, and Delete. Each dialog's open state is
// owned here, outside the DropdownMenu tree — nesting a DialogTrigger inside
// a DropdownMenuItem would unmount the dialog the instant the menu closes.
export function StoryPeekMenu({ detail }: { detail: StoryDetail }) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [epicOpen, setEpicOpen] = useState(false);

  // A container is already split (no board state to split from) and a child
  // can't be split (single-level nesting, doc-18 §3) — split_story rejects
  // both server-side too. A personal-project story never offers Split at all
  // (owner decision: splitting would containerize it, dropping it out of My
  // Work with unassigned children also invisible there).
  const canSplit = !detail.isContainer && detail.parentId === null && !detail.isPersonalProject;

  // A container has no children left to gain, a child can't become an epic
  // (single-level nesting, doc-18 §3), set_epic_pinned requires owner/member,
  // and it rejects a personal-project story outright (My Tasks has no epic
  // grouping) — all mirrored here so the item is hidden rather than offered
  // and left to fail server-side (doc-20 §2).
  const canBecomeEpic =
    !detail.isContainer && detail.parentId === null && detail.viewerIsMember && !detail.isPersonalProject;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Story actions">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canSplit && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                router.push(`/stories/${detail.id}/split`);
              }}
            >
              Split…
            </DropdownMenuItem>
          )}
          {canBecomeEpic && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setEpicOpen(true);
              }}
            >
              Turn into epic…
            </DropdownMenuItem>
          )}
          {/* A container is rejected server-side by both RPCs (doc-18 §8 —
              deleting the source to complete a Move would orphan its
              children) — hidden rather than offered and left to fail. */}
          {!detail.isContainer && (
            <>
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
            </>
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

      <DeleteStoryDialog detail={detail} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <MoveCopyDialog detail={detail} mode="move" open={moveOpen} onOpenChange={setMoveOpen} />
      <MoveCopyDialog detail={detail} mode="copy" open={copyOpen} onOpenChange={setCopyOpen} />
      <TurnIntoEpicDialog detail={detail} open={epicOpen} onOpenChange={setEpicOpen} />
    </>
  );
}

function TurnIntoEpicDialog({
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

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const result = await turnIntoEpic(detail.id, detail.projectId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to turn into epic");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn &ldquo;{detail.title}&rdquo; into an epic?</DialogTitle>
          <DialogDescription>
            &ldquo;{detail.title}&rdquo; will become an epic and leave the board; its points and state are cleared.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleConfirm()} disabled={pending}>
            {pending ? "Turning into epic…" : "Turn into epic"}
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
            {detail.isContainer && detail.childCount > 0 && (
              <>
                {" "}
                Its {detail.childCount} child {detail.childCount === 1 ? "story" : "stories"} will be ungrouped (they
                become top-level stories, not deleted).
              </>
            )}
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
