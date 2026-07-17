"use client";

import { useState, useTransition, type FormEvent } from "react";
import { addComment } from "@/app/stories/[id]/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils/format";
import { CommentBody } from "./comment-body";

export type CommentData = { id: string; body: string; createdAt: string; authorName: string };

// A plain `<form action={...}>` used to back this — no pending state and a
// thrown failure crashed into the route error boundary instead of staying
// inline (fable-advisor review 2026-07-17, TASK-74, same class of bug as
// transition-buttons.tsx). A controlled textarea also keeps the draft on
// failure — the previous version relied on an uncontrolled field the failed
// action never got a chance to clear, which happened to work but wasn't
// guaranteed once errors are actually caught here.
export function CommentThread({
  storyId,
  projectId,
  comments,
  onMutated,
}: {
  storyId: string;
  projectId: string;
  comments: CommentData[];
  // Set only by the board's inline expansion — see task-checklist.tsx for why.
  onMutated?: () => Promise<void> | void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    const formData = new FormData();
    formData.set("story_id", storyId);
    formData.set("project_id", projectId);
    formData.set("body", trimmed);

    setError(null);
    startTransition(async () => {
      try {
        await addComment(formData);
        await onMutated?.();
        setBody("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add the comment");
      }
    });
  }

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h2 className="mb-3 text-lg font-semibold">Comments</h2>

      {comments.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border border-border p-3">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{comment.authorName}</span>
                <span>{formatDateTime(comment.createdAt)}</span>
              </div>
              <CommentBody body={comment.body} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">No comments yet.</p>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          rows={2}
          placeholder="Add a comment… use @username to mention someone"
          disabled={isPending}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Commenting…" : "Comment"}
          </Button>
        </div>
      </form>
    </section>
  );
}
