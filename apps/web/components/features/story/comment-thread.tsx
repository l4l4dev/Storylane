"use client";

import { addComment } from "@/app/stories/[id]/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CommentBody } from "./comment-body";

export type CommentData = { id: string; body: string; createdAt: string; authorName: string };

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
  async function handleAdd(formData: FormData) {
    await addComment(formData);
    await onMutated?.();
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
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
              </div>
              <CommentBody body={comment.body} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">No comments yet.</p>
      )}

      <form action={handleAdd} className="flex flex-col gap-2">
        <input type="hidden" name="story_id" value={storyId} />
        <input type="hidden" name="project_id" value={projectId} />
        <Textarea
          name="body"
          required
          rows={2}
          placeholder="Add a comment… use @username to mention someone"
        />
        <div>
          <Button type="submit">Comment</Button>
        </div>
      </form>
    </section>
  );
}
