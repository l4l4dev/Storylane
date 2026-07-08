"use client";

import { useRouter } from "next/navigation";
import { updateStory, type StoryDetail } from "@/app/stories/[id]/actions";
import { useStoryRealtime } from "@/lib/supabase/realtime";
import { STORY_TYPES } from "@/lib/utils/stories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CommentThread } from "./comment-thread";
import { TaskChecklist } from "./task-checklist";
import { TransitionButtons } from "./transition-buttons";

// Renders the full story detail content — editable fields, state-transition
// buttons, the task checklist, and the comment thread (see spec/screens.md
// "Board layout": the inline expansion shows "the same content as
// `/stories/[id]`"). Used both by that standalone page and by the board's
// inline expansion (story-card.tsx), which is why mutations flow through the
// optional `onMutated` hook rather than relying solely on route revalidation.
export function StoryDetailPanel({
  detail,
  onMutated,
}: {
  detail: StoryDetail;
  onMutated?: () => Promise<void> | void;
}) {
  const router = useRouter();

  async function handleUpdate(formData: FormData) {
    await updateStory(formData);
    await onMutated?.();
  }

  // Task 11: picks up other users' edits to this story's fields or comment
  // thread. The board's inline expansion re-fetches just this story's detail
  // via `onMutated` (`refreshDetail` in story-card.tsx); the standalone
  // `/stories/[id]` page has no such local state, so it refreshes the route.
  useStoryRealtime(detail.id, () => {
    void (onMutated?.() ?? router.refresh());
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Task 14: free-mode projects have no state machine — the status is
          a plain select in the form below instead of transition buttons. */}
      {detail.workflowMode === "tracker" && (
        <TransitionButtons
          storyId={detail.id}
          projectId={detail.projectId}
          state={detail.state}
          storyType={detail.storyType}
          points={detail.points}
        />
      )}

      <form action={handleUpdate} className="flex flex-col gap-4">
        <input type="hidden" name="story_id" value={detail.id} />
        <input type="hidden" name="project_id" value={detail.projectId} />

        {detail.workflowMode === "free" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-status">Status</Label>
            <NativeSelect id="detail-status" name="custom_status_id" defaultValue={detail.customStatusId ?? ""}>
              {detail.customStatuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detail-title">Title</Label>
          <Input id="detail-title" name="title" defaultValue={detail.title} required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detail-description">Description</Label>
          <Textarea
            id="detail-description"
            name="description"
            defaultValue={detail.description ?? ""}
            rows={4}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="detail-type">Type</Label>
            <NativeSelect id="detail-type" name="story_type" defaultValue={detail.storyType}>
              {STORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex w-32 flex-col gap-1.5">
            <Label htmlFor="detail-points">Points</Label>
            {/* Points come from the project's point scale — no free numeric
                input (see spec/features.md). */}
            <NativeSelect id="detail-points" name="points" defaultValue={detail.points ?? ""}>
              <option value="">Unestimated</option>
              {detail.pointScale.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="detail-epic">Epic</Label>
            <NativeSelect id="detail-epic" name="epic_id" defaultValue={detail.epicId ?? ""}>
              <option value="">None</option>
              {detail.epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="detail-assignee">Assignee</Label>
            <NativeSelect
              id="detail-assignee"
              name="assignee_id"
              defaultValue={detail.assigneeId ?? ""}
            >
              <option value="">Unassigned</option>
              {detail.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {detail.labels.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Labels</span>
            <div className="flex flex-wrap gap-2">
              {detail.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="label_ids"
                    value={label.id}
                    defaultChecked={detail.labelIds.includes(label.id)}
                    className="accent-primary"
                  />
                  {label.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-2 flex items-center justify-between">
          <Button type="submit">Save changes</Button>
        </div>
      </form>

      <TaskChecklist storyId={detail.id} tasks={detail.tasks} onMutated={onMutated} />
      <CommentThread
        storyId={detail.id}
        projectId={detail.projectId}
        comments={detail.comments}
        onMutated={onMutated}
      />
    </div>
  );
}
