"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parsePoints } from "@/lib/utils/stories";

export async function updateStory(formData: FormData) {
  const id = String(formData.get("story_id"));
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const storyType = String(formData.get("story_type") ?? "feature");
  const state = String(formData.get("state") ?? "unstarted");
  const points = parsePoints(formData.get("points") as string | null, storyType);
  const epicId = String(formData.get("epic_id") ?? "") || null;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;

  if (!title) {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("stories")
    .update({
      title,
      description,
      story_type: storyType,
      state,
      points,
      epic_id: epicId,
      assignee_id: assigneeId,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  // Sync labels: the form submits the full desired set, so replace wholesale.
  const labelIds = formData.getAll("label_ids").map(String).filter(Boolean);
  const { error: deleteError } = await supabase
    .from("story_labels")
    .delete()
    .eq("story_id", id);
  if (deleteError) {
    throw new Error(deleteError.message);
  }
  if (labelIds.length > 0) {
    const { error: insertError } = await supabase
      .from("story_labels")
      .insert(labelIds.map((labelId) => ({ story_id: id, label_id: labelId })));
    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  revalidatePath(`/stories/${id}`);
  revalidatePath(`/projects/${projectId}/board`);
}

export async function addComment(formData: FormData) {
  const storyId = String(formData.get("story_id"));
  const projectId = String(formData.get("project_id"));
  const body = String(formData.get("body") ?? "").trim();

  if (!body) {
    return;
  }

  const supabase = await createClient();
  // author_id defaults to auth.uid() (see comments migration); a trigger
  // records the comment.added activity log entry.
  const { error } = await supabase.from("comments").insert({ story_id: storyId, body });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/stories/${storyId}`);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteStory(formData: FormData) {
  const id = String(formData.get("story_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  const { error } = await supabase.from("stories").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
  redirect(`/projects/${projectId}/board`);
}
