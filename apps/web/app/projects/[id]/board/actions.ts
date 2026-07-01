"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { autoAssignStoryIds, nextIterationDates, nextIterationNumber } from "@/lib/utils/iterations";
import { nextPosition, parsePoints, reorderPositions } from "@/lib/utils/stories";
import { acceptedPoints, calculateVelocity } from "@/lib/utils/velocity";

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

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

  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * Moves a story to `destination_iteration_id` (empty string = back to the
 * backlog) and persists the resulting order within that destination
 * container. Handles both cross-container drags and same-container
 * reorders (the iteration_id write is a harmless no-op in the latter case),
 * so the board only ever needs this one action per drag.
 */
export async function moveStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const destinationIterationId = String(formData.get("destination_iteration_id") ?? "") || null;
  const orderedIds = formData.getAll("ordered_ids").map(String).filter(Boolean);

  const supabase = await createClient();

  if (destinationIterationId) {
    const { data: iteration } = await supabase
      .from("iterations")
      .select("state")
      .eq("id", destinationIterationId)
      .single();

    if (iteration?.state === "done") {
      throw new Error("Cannot move a story into a finalized iteration");
    }
  }

  const { error } = await supabase
    .from("stories")
    .update({ iteration_id: destinationIterationId })
    .eq("id", storyId);

  if (error) {
    throw new Error(error.message);
  }

  if (orderedIds.length > 0) {
    await Promise.all(
      reorderPositions(orderedIds).map(({ id, position }) =>
        supabase.from("stories").update({ position }).eq("id", id),
      ),
    );
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
}

export async function createIteration(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const goal = String(formData.get("goal") ?? "").trim() || null;

  const supabase = await createClient();

  const [{ data: project }, { data: iterations }, { data: backlog }] = await Promise.all([
    supabase.from("projects").select("iteration_length, velocity_window").eq("id", projectId).single(),
    supabase.from("iterations").select("number, end_date, state, velocity").eq("project_id", projectId),
    supabase
      .from("stories")
      .select("id, points, story_type")
      .eq("project_id", projectId)
      .is("iteration_id", null)
      .order("position", { ascending: true }),
  ]);

  if (!project) {
    throw new Error("Project not found");
  }

  const completed = (iterations ?? [])
    .filter((iteration) => iteration.state === "done")
    .sort((a, b) => b.number - a.number);
  const velocity = calculateVelocity(completed, project.velocity_window);

  const { start_date, end_date } = nextIterationDates(
    iterations ?? [],
    project.iteration_length,
    todayDateOnly(),
  );
  const number = nextIterationNumber(iterations ?? []);

  const { data: iteration, error } = await supabase
    .from("iterations")
    .insert({ project_id: projectId, number, goal, start_date, end_date })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const assignedIds = autoAssignStoryIds(backlog ?? [], velocity);
  if (iteration && assignedIds.length > 0) {
    await Promise.all(
      assignedIds.map((id) =>
        supabase.from("stories").update({ iteration_id: iteration.id }).eq("id", id),
      ),
    );
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
}

export async function updateIterationGoal(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const iterationId = String(formData.get("iteration_id"));
  const goal = String(formData.get("goal") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("iterations").update({ goal }).eq("id", iterationId);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
}

export async function finalizeIteration(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const iterationId = String(formData.get("iteration_id"));

  const supabase = await createClient();
  const { data: stories } = await supabase
    .from("stories")
    .select("state, points, story_type")
    .eq("iteration_id", iterationId);

  const velocity = acceptedPoints(stories ?? []);

  const { error } = await supabase
    .from("iterations")
    .update({ velocity, state: "done" })
    .eq("id", iterationId);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
}
