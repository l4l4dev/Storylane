"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextPosition, pointScaleValues } from "@/lib/utils/stories";

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
  workflowMode: "tracker" | "free";
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
    workflowMode: project?.workflow_mode === "free" ? "free" : "tracker",
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

export type UpdateStoryInput = {
  storyId: string;
  title: string;
  description: string | null;
  storyType: string;
  points: number | null;
  epicId: string | null;
  assigneeId: string | null;
  // Free-mode-only (Task 14); null leaves the column unchanged — see the
  // update_story RPC's coalesce.
  customStatusId: string | null;
  labelIds: string[];
};

export type UpdateStoryFields = {
  title: string;
  description: string | null;
  storyType: string;
  points: number | null;
  epicId: string | null;
  assigneeId: string | null;
  customStatusId: string | null;
  labelIds: string[];
};

export type UpdateStoryResult =
  | { ok: true; story: UpdateStoryFields }
  // "not_found" covers both a genuinely deleted story and one RLS no longer
  // lets this caller update — the detail panel treats either as "this story
  // is no longer editable" (spec/screens.md "story was deleted" state).
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "error"; message: string };

/**
 * Autosave entry point for the story detail form (Task 12,
 * spec/screens.md "Conflict & failure rules") — called directly from
 * `StoryDetailPanel`'s client-side save orchestrator, not a `<form action>`,
 * since each field save needs its own typed result rather than an
 * unstructured FormData throw. All validation (empty title, points against
 * the project's point scale) and the story_labels replace happen
 * transactionally inside the `update_story` RPC — see its migration for why.
 *
 * Never calls `revalidatePath`: the caller applies the returned row into its
 * own local state directly, and the board's inline cards/list pick up the
 * change through their existing `useProjectBoardRealtime` subscription —
 * forcing a fresh `detail` prop here would re-introduce a second channel
 * (alongside Realtime) that could clobber a field the user is still editing.
 */
export async function updateStory(input: UpdateStoryInput): Promise<UpdateStoryResult> {
  const supabase = await createClient();

  // The generated RPC Args type marks every parameter non-null — Postgres
  // function signatures have no NOT NULL annotation for the generator to
  // pick up the way table columns do, even though update_story's SQL body
  // accepts and handles null for each of these. The casts below are exactly
  // that known codegen gap, not a real non-null guarantee.
  const { data, error } = await supabase.rpc("update_story", {
    p_story_id: input.storyId,
    p_title: input.title,
    p_description: input.description as string,
    p_story_type: input.storyType,
    p_points: input.points as number,
    p_epic_id: input.epicId as string,
    p_assignee_id: input.assigneeId as string,
    p_custom_status_id: input.customStatusId as string,
    p_label_ids: input.labelIds,
  });

  if (error) {
    return { ok: false, reason: "error", message: error.message };
  }

  const row = data?.[0];
  if (!row) {
    return { ok: false, reason: "not_found" };
  }

  return {
    ok: true,
    story: {
      title: row.title,
      description: row.description,
      storyType: row.story_type,
      points: row.points,
      epicId: row.epic_id,
      assigneeId: row.assignee_id,
      customStatusId: row.custom_status_id,
      labelIds: row.label_ids ?? [],
    },
  };
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
