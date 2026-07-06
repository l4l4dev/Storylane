"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { BACKLOG_CONTAINER_ID, ICEBOX_CONTAINER_ID } from "@/lib/utils/board";
import { columnForStory, evaluateDrop, type KanbanColumnId } from "@/lib/utils/kanban";
import { isCurrentIteration, nextIterationDates, nextIterationNumber } from "@/lib/utils/iterations";
import {
  isUnestimatedFeature,
  nextPosition,
  parsePoints,
  pointScaleValues,
  reorderPositions,
} from "@/lib/utils/stories";
import { applyTransition, type StoryState, type StoryTransitionAction } from "@/lib/utils/story-state";
import { acceptedPoints } from "@/lib/utils/velocity";

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createStory(formData: FormData) {
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

  // Append to the bottom of the backlog. Reading the current max position keeps
  // positions dense without a DB sequence.
  const [{ data: existing }, { data: project }] = await Promise.all([
    supabase.from("stories").select("position").eq("project_id", projectId),
    supabase.from("projects").select("point_scale, custom_points").eq("id", projectId).single(),
  ]);

  if (!project) {
    throw new Error("Project not found");
  }

  const points = parsePoints(
    formData.get("points") as string | null,
    storyType,
    pointScaleValues(project.point_scale, project.custom_points),
  );

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
 * Moves a story to `destination_container` — `backlog`, `icebox`, or an
 * iteration id — and persists the resulting order within that destination
 * container. Handles both cross-container drags and same-container
 * reorders (the iteration_id write is a harmless no-op in the latter case),
 * so the board only ever needs this one action per drag.
 *
 * Crossing the Icebox boundary also flips `state` between `unscheduled` and
 * `unstarted` (see spec/screens.md "Board layout": dragging Icebox -> Backlog
 * promotes the story; the reverse demotes it). `unscheduled` has no
 * transition-button path (see story-state.ts), so this drag is the only way
 * in or out of it.
 */
export async function moveStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const destinationContainer = String(formData.get("destination_container") ?? BACKLOG_CONTAINER_ID);
  const orderedIds = formData.getAll("ordered_ids").map(String).filter(Boolean);

  const supabase = await createClient();

  const isIcebox = destinationContainer === ICEBOX_CONTAINER_ID;
  const destinationIterationId =
    isIcebox || destinationContainer === BACKLOG_CONTAINER_ID ? null : destinationContainer;

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

  const { data: story } = await supabase.from("stories").select("state").eq("id", storyId).single();

  const update: { iteration_id: string | null; state?: StoryState } = {
    iteration_id: destinationIterationId,
  };
  if (isIcebox) {
    update.state = "unscheduled";
  } else if (story?.state === "unscheduled") {
    update.state = "unstarted";
  }

  const { error } = await supabase.from("stories").update(update).eq("id", storyId);

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

/**
 * Handles a kanban drop (see spec/screens.md "Board layout": drag = state
 * transition). Re-derives the story's source column and re-validates the
 * move server-side with the same pure `evaluateDrop` the client uses, so a
 * stale or tampered client can't force an invalid transition. Also persists
 * the resulting order within the target column.
 */
export async function dropStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const targetColumn = String(formData.get("target_column")) as KanbanColumnId;
  const orderedIds = formData.getAll("ordered_ids").map(String).filter(Boolean);

  const supabase = await createClient();

  const [{ data: story, error: fetchError }, { data: currentRows }] = await Promise.all([
    supabase
      .from("stories")
      .select("state, story_type, points, iteration_id")
      .eq("id", storyId)
      .single(),
    supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .order("number", { ascending: false })
      .limit(1),
  ]);

  if (fetchError || !story) {
    throw new Error(fetchError?.message ?? "Story not found");
  }

  const currentIterationId = currentRows?.[0]?.id ?? null;
  if (!currentIterationId) {
    throw new Error("No active iteration");
  }

  const from = columnForStory(story, currentIterationId);
  const evaluation = evaluateDrop(story, from, targetColumn);
  if (!evaluation.ok) {
    throw new Error(evaluation.reason);
  }

  const update: { state?: string; iteration_id?: string | null } = {};
  if (evaluation.state) {
    update.state = evaluation.state;
  }
  if (evaluation.iteration === "current") {
    update.iteration_id = currentIterationId;
  } else if (evaluation.iteration === "none") {
    update.iteration_id = null;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("stories").update(update).eq("id", storyId);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (orderedIds.length > 0) {
    await Promise.all(
      reorderPositions(orderedIds).map(({ id, position }) =>
        supabase.from("stories").update({ position }).eq("id", id),
      ),
    );
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${storyId}`);
}

/**
 * Applies a one-click state-transition button (Start / Finish / Deliver /
 * Accept / Reject / Restart — see spec/screens.md "Story card UX"). Reads
 * the story's current state server-side rather than trusting the client so
 * a stale card can't force an invalid jump.
 */
export async function transitionStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const action = String(formData.get("action")) as StoryTransitionAction;

  const supabase = await createClient();
  const { data: story, error: fetchError } = await supabase
    .from("stories")
    .select("state, story_type, points")
    .eq("id", storyId)
    .single();

  if (fetchError || !story) {
    throw new Error(fetchError?.message ?? "Story not found");
  }

  const nextState = applyTransition(story.state as StoryState, action);

  // An unestimated feature cannot be started (see spec/features.md) — this
  // covers both Start and Restart, whose target state is `started`.
  if (nextState === "started" && isUnestimatedFeature(story.story_type, story.points)) {
    throw new Error("An unestimated feature cannot be started");
  }

  const { error } = await supabase.from("stories").update({ state: nextState }).eq("id", storyId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/stories/${storyId}`);
}

/**
 * Lazily keeps a project's current iteration row up to date (see
 * spec/velocity.md "Automatic scheduling & rollover"). Replaces the old
 * manual "Generate next iteration" / "Mark as done" buttons: called on first
 * access from every view that reads iterations, before it queries them.
 *
 * - A fresh project with no iteration rows gets iteration #1 starting today.
 * - Once the current row's `end_date` has passed, it's finalized (velocity
 *   stored, `state` set to `done`) and unaccepted stories are carried into a
 *   newly created next iteration. This repeats until a row covers today, so
 *   a project left untouched for more than one `iteration_length` catches up
 *   in one call instead of getting stuck on a stale iteration.
 */
export async function ensureCurrentIteration(projectId: string) {
  const supabase = await createClient();
  const today = todayDateOnly();

  const { data: project } = await supabase
    .from("projects")
    .select("iteration_length")
    .eq("id", projectId)
    .single();

  if (!project) {
    return;
  }

  for (;;) {
    const { data: latestRows } = await supabase
      .from("iterations")
      .select("id, number, start_date, end_date, state")
      .eq("project_id", projectId)
      .order("number", { ascending: false })
      .limit(1);

    const latest = latestRows?.[0] ?? null;

    if (latest && isCurrentIteration(latest, today)) {
      return;
    }

    let carryStoryIds: string[] = [];
    if (latest && latest.state !== "done") {
      const { data: stories } = await supabase
        .from("stories")
        .select("id, state, points, story_type")
        .eq("iteration_id", latest.id);

      const velocity = acceptedPoints(stories ?? []);
      const { error } = await supabase
        .from("iterations")
        .update({ velocity, state: "done" })
        .eq("id", latest.id);
      if (error) {
        throw new Error(error.message);
      }

      carryStoryIds = (stories ?? [])
        .filter((story) => story.state !== "accepted")
        .map((story) => story.id);
    }

    const { start_date, end_date } = nextIterationDates(
      latest ? [latest] : [],
      project.iteration_length,
      today,
    );
    const number = nextIterationNumber(latest ? [latest] : []);

    const { data: nextIteration, error } = await supabase
      .from("iterations")
      .insert({ project_id: projectId, number, start_date, end_date })
      .select("id")
      .single();

    if (error) {
      // Two concurrent calls (e.g. the board and project-home pages both
      // triggering the same rollover) can race on this insert — the loser
      // hits the (project_id, number) unique constraint. Re-fetch and retry
      // rather than surfacing an error: the winner already created the row
      // and, if it had stories to carry, already moved them.
      if (error.code === "23505") {
        continue;
      }
      throw new Error(error.message);
    }

    if (nextIteration && carryStoryIds.length > 0) {
      await Promise.all(
        carryStoryIds.map((id) =>
          supabase.from("stories").update({ iteration_id: nextIteration.id }).eq("id", id),
        ),
      );
    }
  }
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
