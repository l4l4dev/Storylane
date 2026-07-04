"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUnestimatedFeature, nextPosition, parsePoints, pointScaleValues } from "@/lib/utils/stories";

export async function updateStory(formData: FormData) {
  const id = String(formData.get("story_id"));
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const storyType = String(formData.get("story_type") ?? "feature");
  const state = String(formData.get("state") ?? "unstarted");
  const epicId = String(formData.get("epic_id") ?? "") || null;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;

  if (!title) {
    return;
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("point_scale, custom_points")
    .eq("id", projectId)
    .single();

  if (!project) {
    throw new Error("Project not found");
  }

  const points = parsePoints(
    formData.get("points") as string | null,
    storyType,
    pointScaleValues(project.point_scale, project.custom_points),
  );

  // An unestimated feature cannot be started (see spec/features.md). The
  // free-form state select lives here until Task 12.5 step 7 replaces it,
  // so the invariant is enforced server-side too.
  if (state === "started" && isUnestimatedFeature(storyType, points)) {
    throw new Error("An unestimated feature cannot be started");
  }
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

export async function addTask(formData: FormData) {
  const storyId = String(formData.get("story_id"));
  const title = String(formData.get("title") ?? "").trim();

  if (!title) {
    return;
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from("tasks").select("position").eq("story_id", storyId);
  const { error } = await supabase
    .from("tasks")
    .insert({ story_id: storyId, title, position: nextPosition(existing ?? []) });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/stories/${storyId}`);
}

export async function toggleTask(formData: FormData) {
  const taskId = String(formData.get("task_id"));
  const storyId = String(formData.get("story_id"));
  const isDone = formData.get("is_done") === "true";

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ is_done: !isDone }).eq("id", taskId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/stories/${storyId}`);
}

export async function deleteTask(formData: FormData) {
  const taskId = String(formData.get("task_id"));
  const storyId = String(formData.get("story_id"));

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/stories/${storyId}`);
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
