"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nextPosition, parsePoints, reorderPositions } from "@/lib/utils/stories";

export async function createStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const storyType = String(formData.get("story_type") ?? "feature");
  const points = parsePoints(formData.get("points") as string | null, storyType);
  const epicId = String(formData.get("epic_id") ?? "") || null;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;

  if (!title) {
    return;
  }

  const supabase = await createClient();

  // Append to the bottom of the backlog. Reading the current max position keeps
  // positions dense without a DB sequence.
  const { data: existing } = await supabase
    .from("stories")
    .select("position")
    .eq("project_id", projectId);

  const { data: story, error } = await supabase
    .from("stories")
    .insert({
      project_id: projectId,
      title,
      description,
      story_type: storyType,
      points,
      epic_id: epicId,
      assignee_id: assigneeId,
      position: nextPosition(existing ?? []),
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const labelIds = formData.getAll("label_ids").map(String).filter(Boolean);
  if (story && labelIds.length > 0) {
    const { error: labelError } = await supabase
      .from("story_labels")
      .insert(labelIds.map((labelId) => ({ story_id: story.id, label_id: labelId })));
    if (labelError) {
      throw new Error(labelError.message);
    }
  }

  revalidatePath(`/projects/${projectId}/backlog`);
}

export async function reorderStories(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const orderedIds = formData.getAll("ordered_ids").map(String).filter(Boolean);

  if (orderedIds.length === 0) {
    return;
  }

  const supabase = await createClient();

  // Persist each new position. Stories already carry project_id, so we scope the
  // update by id; RLS still confines it to the caller's projects.
  await Promise.all(
    reorderPositions(orderedIds).map(({ id, position }) =>
      supabase.from("stories").update({ position }).eq("id", id),
    ),
  );

  revalidatePath(`/projects/${projectId}/backlog`);
}
