"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export type MyWorkColumn = "todo" | "today" | "doing" | "done";

// set_story_state raises this (errcode P0001) when a mapped Doing/Done drag
// would start a story but the target project has no current iteration to
// schedule it into (doc-14: the one place My Work reintroduces an iteration
// dependency). Surfaced as a visible, actionable message instead of the raw
// exception text so a failed drag never looks like it silently did nothing
// (ux-principles.md principle 2).
const NO_ITERATION_MESSAGE =
  "This project has no active iteration to start the story in — open its board to start an iteration first.";

/**
 * Moves a card between My Work's columns (doc-14 "Dragging a card"). My Work
 * keeps its OWN status (my_work_story_state), optionally synced to the real
 * board when the project maps Doing/Done to its own states:
 *
 *   - Todo / Today  — always a my_work_story_state-only write, never a project
 *     transition (backward/personal moves stay local, mapped or not).
 *   - Doing / Done  — when the project's mapping still points to a live state
 *     of the right category, transition the REAL state via set_story_state
 *     (single source of truth, no local_status divergence). Otherwise it's a
 *     local-only my_work_story_state.local_status write.
 *
 * Every non-Today drop also clears is_today — that's the "leave Today" half of
 * the move, so a card marked Today doesn't stay pinned there (Today outranks
 * Doing in classification).
 */
export async function setMyWorkColumn(storyId: string, column: MyWorkColumn): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Not signed in" };
  }

  const { data: story, error: storyError } = await supabase
    .from("stories")
    .select("project_id")
    .eq("id", storyId)
    .single();
  if (storyError || !story) {
    return { ok: false, message: storyError?.message ?? "Story not found" };
  }

  // Doing/Done sync only when a valid mapping exists.
  if (column === "doing" || column === "done") {
    const mappedStateId = await resolveMappedState(supabase, story.project_id, column);
    if (mappedStateId) {
      const { error } = await supabase.rpc("set_story_state", {
        p_story_id: storyId,
        p_state_id: mappedStateId,
      });
      if (error) {
        return {
          ok: false,
          message: error.message === "No active iteration" ? NO_ITERATION_MESSAGE : error.message,
        };
      }
      // Mapped: the real state is the single source of truth, so don't write a
      // local_status (no divergence). Only clear is_today (leave-Today half).
      const localWrite = await writeMark(supabase, user.id, storyId, false, undefined);
      if (localWrite) return localWrite;
      revalidatePaths(story.project_id, storyId);
      return { ok: true };
    }
  }

  // Local-only write: Todo/Today, or an unmapped Doing/Done.
  const isToday = column === "today";
  // "Today" preserves any existing local_status (undefined = leave as-is);
  // Todo/unmapped-Doing/Done set it explicitly.
  const localStatus = column === "today" ? undefined : column;
  const localWrite = await writeMark(supabase, user.id, storyId, isToday, localStatus);
  if (localWrite) return localWrite;
  revalidatePaths(story.project_id, storyId);
  return { ok: true };
}

// Returns the mapped state id for the target column only when the mapping still
// points to a live state of the matching category (doc-14: a category change is
// treated read-side as unmapped, no trigger needed). Null = unmapped/broken.
async function resolveMappedState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  column: "doing" | "done",
): Promise<string | null> {
  const { data: mapping } = await supabase
    .from("project_my_work_mapping")
    .select("doing_state_id, done_state_id")
    .eq("project_id", projectId)
    .maybeSingle();
  const stateId = column === "doing" ? mapping?.doing_state_id : mapping?.done_state_id;
  if (!stateId) return null;
  const wantCategory = column === "doing" ? "in_progress" : "done";
  const { data: state } = await supabase.from("project_states").select("category").eq("id", stateId).single();
  return state?.category === wantCategory ? stateId : null;
}

// Upserts the viewer's mark. `localStatus === undefined` preserves the current
// value (read-modify-write, since upsert would otherwise null it); a concrete
// value or null overwrites it.
async function writeMark(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  storyId: string,
  isToday: boolean,
  localStatus: "todo" | "doing" | "done" | null | undefined,
): Promise<ActionResult | null> {
  let nextLocal = localStatus ?? null;
  if (localStatus === undefined) {
    const { data: existing } = await supabase
      .from("my_work_story_state")
      .select("local_status")
      .eq("user_id", userId)
      .eq("story_id", storyId)
      .maybeSingle();
    // DB CHECK constrains local_status to this union; the generated type widens it to string.
    nextLocal = (existing?.local_status as "todo" | "doing" | "done" | null) ?? null;
  }
  const { error } = await supabase.from("my_work_story_state").upsert(
    { user_id: userId, story_id: storyId, is_today: isToday, local_status: nextLocal, updated_at: new Date().toISOString() },
    { onConflict: "user_id,story_id" },
  );
  return error ? { ok: false, message: error.message } : null;
}

function revalidatePaths(projectId: string, storyId: string) {
  revalidatePath("/my-work");
  // A mapped drag changed the real board too.
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${storyId}`);
}
