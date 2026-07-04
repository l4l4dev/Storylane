"use client";

import { useRouter } from "next/navigation";
import { updateStory, type StoryDetail } from "@/app/stories/[id]/actions";
import { useStoryRealtime } from "@/lib/supabase/realtime";
import { STORY_TYPES } from "@/lib/utils/stories";
import { CommentThread } from "./comment-thread";
import { TaskChecklist } from "./task-checklist";
import { TransitionButtons } from "./transition-buttons";

const inputClass = "rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800";

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
      <TransitionButtons
        storyId={detail.id}
        projectId={detail.projectId}
        state={detail.state}
        storyType={detail.storyType}
        points={detail.points}
      />

      <form action={handleUpdate} className="flex flex-col gap-4">
        <input type="hidden" name="story_id" value={detail.id} />
        <input type="hidden" name="project_id" value={detail.projectId} />

        <label className="flex flex-col gap-1 text-sm">
          <span>Title</span>
          <input name="title" defaultValue={detail.title} required className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Description</span>
          <textarea
            name="description"
            defaultValue={detail.description ?? ""}
            rows={4}
            className={inputClass}
          />
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Type</span>
            <select name="story_type" defaultValue={detail.storyType} className={inputClass}>
              {STORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="flex w-32 flex-col gap-1 text-sm">
            <span>Points</span>
            {/* Points come from the project's point scale — no free numeric
                input (see spec/features.md). */}
            <select name="points" defaultValue={detail.points ?? ""} className={inputClass}>
              <option value="">Unestimated</option>
              {detail.pointScale.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Epic</span>
            <select name="epic_id" defaultValue={detail.epicId ?? ""} className={inputClass}>
              <option value="">None</option>
              {detail.epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Assignee</span>
            <select name="assignee_id" defaultValue={detail.assigneeId ?? ""} className={inputClass}>
              <option value="">Unassigned</option>
              {detail.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {detail.labels.length > 0 && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <span>Labels</span>
            <div className="flex flex-wrap gap-2">
              {detail.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="label_ids"
                    value={label.id}
                    defaultChecked={detail.labelIds.includes(label.id)}
                  />
                  {label.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-2 flex items-center justify-between">
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Save changes
          </button>
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
