"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextPosition, parsePoints, pointScaleValues } from "@/lib/utils/stories";

export type StoryDetail = {
  id: string;
  projectId: string;
  // Per-project sequential story number — shown as #123, referenced as
  // [SL-123] in PR titles (see spec/integrations.md).
  number: number;
  title: string;
  description: string | null;
  storyType: string;
  state: string;
  points: number | null;
  epicId: string | null;
  assigneeId: string | null;
  labelIds: string[];
  pointScale: number[];
  // Task 14: free-mode projects swap the state machine for custom statuses.
  workflowMode: "pivotal" | "free";
  customStatusId: string | null;
  customStatuses: { id: string; name: string }[];
  epics: { id: string; name: string }[];
  labels: { id: string; name: string }[];
  members: { id: string; name: string }[];
  comments: { id: string; body: string; createdAt: string; authorName: string }[];
  tasks: { id: string; title: string; is_done: boolean }[];
};

/**
 * Fetches everything the story detail UI needs (fields, comments, tasks).
 * Shared by the standalone `/stories/[id]` page and the board's inline
 * expansion (see spec/screens.md "Board layout") so the two stay in sync —
 * the inline panel calls this directly as a client-invoked server action.
 */
export async function getStoryDetail(storyId: string): Promise<StoryDetail | null> {
  const supabase = await createClient();

  const { data: story } = await supabase
    .from("stories")
    .select("*, story_labels(label_id)")
    .eq("id", storyId)
    .single();

  if (!story) {
    return null;
  }

  const [{ data: project }, { data: epics }, { data: labels }, { data: members }, { data: comments }, { data: tasks }, { data: customStatuses }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("point_scale, custom_points, workflow_mode")
        .eq("id", story.project_id)
        .single(),
      supabase.from("epics").select("id, name").eq("project_id", story.project_id).order("position"),
      supabase.from("labels").select("id, name").eq("project_id", story.project_id).order("name"),
      supabase
        .from("project_members")
        .select("user_id, profiles(display_name)")
        .eq("project_id", story.project_id),
      supabase
        .from("comments")
        .select("id, body, created_at, author:profiles(display_name)")
        .eq("story_id", storyId)
        .order("created_at", { ascending: true }),
      supabase.from("tasks").select("id, title, is_done").eq("story_id", storyId).order("position"),
      supabase
        .from("custom_statuses")
        .select("id, name")
        .eq("project_id", story.project_id)
        .order("position", { ascending: true }),
    ]);

  return {
    id: story.id,
    projectId: story.project_id,
    number: story.number,
    title: story.title,
    description: story.description,
    storyType: story.story_type,
    state: story.state,
    points: story.points,
    epicId: story.epic_id,
    assigneeId: story.assignee_id,
    labelIds: story.story_labels.map((sl) => sl.label_id),
    pointScale: pointScaleValues(project?.point_scale ?? "fibonacci", project?.custom_points),
    workflowMode: project?.workflow_mode === "free" ? "free" : "pivotal",
    customStatusId: story.custom_status_id,
    customStatuses: customStatuses ?? [],
    epics: epics ?? [],
    labels: labels ?? [],
    members: (members ?? []).map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return { id: m.user_id, name: profile?.display_name ?? m.user_id.slice(0, 8) };
    }),
    comments: (comments ?? []).map((comment) => {
      const author = Array.isArray(comment.author) ? comment.author[0] : comment.author;
      return {
        id: comment.id,
        body: comment.body,
        createdAt: comment.created_at,
        authorName: author?.display_name ?? "Unknown",
      };
    }),
    tasks: tasks ?? [],
  };
}

export async function updateStory(formData: FormData) {
  const id = String(formData.get("story_id"));
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const storyType = String(formData.get("story_type") ?? "feature");
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

  // `state` is never written here — it's exclusively managed by the
  // one-click transition buttons (see transitionStory in the board
  // actions), which also enforce "an unestimated feature cannot be started".
  // Free-mode projects (Task 14) instead submit `custom_status_id` from the
  // detail panel's status select; the composite FK rejects a status of
  // another project.
  const update: {
    title: string;
    description: string | null;
    story_type: string;
    points: number | null;
    epic_id: string | null;
    assignee_id: string | null;
    custom_status_id?: string;
  } = {
    title,
    description,
    story_type: storyType,
    points,
    epic_id: epicId,
    assignee_id: assigneeId,
  };
  const customStatusId = String(formData.get("custom_status_id") ?? "");
  if (customStatusId) {
    update.custom_status_id = customStatusId;
  }

  const { error } = await supabase.from("stories").update(update).eq("id", id);

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
