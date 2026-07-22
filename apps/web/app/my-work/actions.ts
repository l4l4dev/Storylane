"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import type { ActionResult } from "@/lib/types";
import type { MyWorkColumnId } from "@/lib/utils/my-work";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Moves a card between My Work's columns (doc-15 "Dragging a card"). My Work is
 * a purely personal board — there is no project-board mapping. Placement rules:
 *
 *   - Personal-project stories (is_personal): Todo/Done write the REAL state
 *     via set_story_state (Done → completed_at + story_completions permanent
 *     log; Todo → the lowest unstarted state, i.e. reopen). Today and free
 *     columns stay local marks. The personal project's states are category-
 *     resolvable without configuration (it's ours, template known).
 *   - Team stories: every drag is a local my_work_story_state mark. Completing
 *     happens on the story's own board (Done is not writable here); the
 *     completion still lands in the viewer's Done log via the story_completions
 *     trigger.
 *
 * Today overlays a card's column (it keeps its column_id) so declining a
 * carry-over next day drops it back where it was. Every other target clears the
 * Today mark. `clientToday` is the viewer's local wall date (YYYY-MM-DD) — DB
 * current_date is UTC and would shift the day boundary.
 */
export async function setMyWorkColumn(
  storyId: string,
  target: MyWorkColumnId,
  clientToday: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const { data: story, error: storyError } = await supabase
    .from("stories")
    .select("project_id, state_id, projects(is_personal)")
    .eq("id", storyId)
    .single();
  if (storyError || !story) {
    return { ok: false, message: storyError?.message ?? "Story not found" };
  }
  const project = Array.isArray(story.projects) ? story.projects[0] : story.projects;
  const isPersonal = project?.is_personal ?? false;

  // Personal Todo/Done: write the real state (single source of truth), then
  // clear local marks — the card's home is now the real board's category.
  if (isPersonal && (target === "todo" || target === "done")) {
    const category = target === "done" ? "done" : "unstarted";
    const stateId = await lowestStateOfCategory(supabase, story.project_id, category);
    if (!stateId) return { ok: false, message: `This project has no ${category} state to move the story into.` };
    const { error } = await supabase.rpc("set_story_state", { p_story_id: storyId, p_state_id: stateId });
    if (error) return { ok: false, message: error.message };
    return persistMark(
      supabase,
      user.id,
      storyId,
      { column_id: null, column_position: null, today_date: null, today_position: null },
      story.project_id,
    );
  }

  // Team story → Done: not writable from My Work (doc-15 decision 5).
  if (target === "done") {
    return {
      ok: false,
      message: "Complete this story on its project board — it lands in your Done log automatically.",
    };
  }

  // A team story already real-done can't be moved out of Done via a local mark:
  // classification excludes real-done from active columns, so the card would
  // snap back to Done on the next refresh with no explanation (ux-principles
  // principle 2). Personal real-done is handled by the Todo branch above (it
  // reopens the real state).
  if (!isPersonal && (await isRealCategoryDone(supabase, story.state_id))) {
    return {
      ok: false,
      message: "This story is already completed on its project board — reopen it there to move it out of Done.",
    };
  }

  // Local marks. Today keeps column_id (it overlays); Todo/free clear it.
  // Every branch that changes column_id also resets column_position — a free
  // column's manual order is meaningless outside that column, and a stale
  // value left behind either violates the column_position/column_id check
  // constraint (moving to Todo) or misorders the target free column with a
  // leftover position from the one the card just left.
  if (target === "today") {
    const today_position = await nextTodayPosition(supabase, user.id, clientToday);
    return persistMark(supabase, user.id, storyId, { today_date: clientToday, today_position }, story.project_id);
  }
  if (target === "todo") {
    return persistMark(
      supabase,
      user.id,
      storyId,
      { column_id: null, column_position: null, today_date: null, today_position: null },
      story.project_id,
    );
  }
  // A free column uuid. RLS already scopes columns to the viewer; verify here
  // for a friendly error rather than a silent FK violation.
  if (!(await ownsColumn(supabase, user.id, target))) {
    return { ok: false, message: "Unknown column." };
  }
  return persistMark(
    supabase,
    user.id,
    storyId,
    { column_id: target, column_position: null, today_date: null, today_position: null },
    story.project_id,
  );
}

/**
 * Carry-over confirmation (doc-15 decision 4): stale Today marks (a past
 * today_date) either move to today or fall back to their column. Bulk, keyed by
 * story id and scoped to the viewer's own marks.
 */
export async function carryOverToday(storyIds: string[], clientToday: string): Promise<ActionResult> {
  if (storyIds.length === 0) return { ok: true };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  const { error } = await supabase
    .from("my_work_story_state")
    .update({ today_date: clientToday, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .in("story_id", storyIds);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/my-work");
  return { ok: true };
}

export async function dismissCarryOver(storyIds: string[]): Promise<ActionResult> {
  if (storyIds.length === 0) return { ok: true };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  const { error } = await supabase
    .from("my_work_story_state")
    .update({ today_date: null, today_position: null, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .in("story_id", storyIds);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Persists a manual reorder WITHIN Today (doc-15 decision 4: "Cards inside
 * Today are manually orderable" — the day's execution order). `orderedStoryIds`
 * is the viewer's full Today list in its new order; each gets a dense 0-based
 * today_position, mirroring TASK-135's iteration-wide position backfill — a
 * full re-densify keeps the write simple for a list this small and single-
 * user, no anchor/midpoint bookkeeping needed.
 *
 * Only `today_position` is named in the upsert payload, so column_id/
 * today_date are left untouched on the existing rows (the established
 * partial-upsert behavior this file's other marks already rely on) — a
 * reorder never changes which day or which free column a card belongs to.
 */
export async function reorderMyWorkToday(orderedStoryIds: string[]): Promise<ActionResult> {
  if (orderedStoryIds.length === 0) return { ok: true };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  const { error } = await supabase.from("my_work_story_state").upsert(
    orderedStoryIds.map((storyId, index) => ({
      user_id: user.id,
      story_id: storyId,
      today_position: index,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,story_id" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Persists a manual reorder WITHIN a free column — generalizes
 * reorderMyWorkToday's approach to any user-defined column: same full
 * re-densify, same partial-upsert shape naming only column_position so
 * today_date/column_id are left untouched on the existing rows.
 */
export async function reorderMyWorkColumn(orderedStoryIds: string[]): Promise<ActionResult> {
  if (orderedStoryIds.length === 0) return { ok: true };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  const { error } = await supabase.from("my_work_story_state").upsert(
    orderedStoryIds.map((storyId, index) => ({
      user_id: user.id,
      story_id: storyId,
      column_position: index,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,story_id" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Adds a free column (TASK-141, doc-15: "add/rename/delete/reorder"). Lands at
 * the end of the user's own columns (`position` = current max + 1) — its place
 * in the combined display order (which also covers Todo/Today/Done) is a
 * separate concern, resolved read-side by resolveColumnOrder appending any
 * column not yet in the stored order.
 */
export async function createMyWorkColumn(name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Name is required" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const { data: maxRow } = await supabase
    .from("my_work_columns")
    .select("position")
    .eq("user_id", user.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxRow?.position ?? -1) + 1;

  const { error } = await supabase.from("my_work_columns").insert({ user_id: user.id, name: trimmed, position });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/my-work");
  return { ok: true };
}

export async function renameMyWorkColumn(columnId: string, name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Name is required" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  try {
    await assertRowAffected(
      await supabase.from("my_work_columns").update({ name: trimmed }).eq("id", columnId).eq("user_id", user.id).select("id"),
    );
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to rename" };
  }
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Deletes a free column. Its cards fall back to Todo with no extra app logic:
 * the composite FK's `on delete set null (column_id)` (20260722000007) nulls
 * only column_id on every my_work_story_state row that pointed at it.
 */
export async function deleteMyWorkColumn(columnId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  try {
    await assertRowAffected(
      await supabase.from("my_work_columns").delete().eq("id", columnId).eq("user_id", user.id).select("id"),
    );
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to delete" };
  }
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Renames one of the three FIXED slots (Todo/Today/Done) — a per-user display
 * label only; the slot id and every behavior keyed off it (classification,
 * drag targets) is untouched. Read-modify-write since the column is a single
 * jsonb map covering all three slots (mirrors createMyWorkColumn's own
 * read-then-write for its position).
 */
export async function renameMyWorkFixedColumn(slot: "todo" | "today" | "done", name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Name is required" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  // The read's error is checked (unlike a fresh row's expected-empty case) —
  // an unnoticed failure here would fall through to `current = {}` and the
  // write below would silently wipe out the other two slots' saved names.
  const { data: profileRow, error: readError } = await supabase
    .from("profiles")
    .select("my_work_column_names")
    .eq("id", user.id)
    .single();
  if (readError) return { ok: false, message: readError.message };
  const current = (profileRow?.my_work_column_names ?? {}) as Record<string, string>;
  const next = { ...current, [slot]: trimmed };

  try {
    await assertRowAffected(
      await supabase.from("profiles").update({ my_work_column_names: next }).eq("id", user.id).select("id"),
    );
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to rename" };
  }
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Persists the viewer's full column display order (TASK-141, doc-15: "the
 * order covers the three fixed slots too"). The client computes the new order
 * by swapping two adjacent slot ids (see resolveColumnOrder for how a stored
 * order is read back); this just writes it verbatim — read-side merging
 * against the live column set (resolveColumnOrder) keeps a stale or missing id
 * harmless, so no validation is needed here.
 */
export async function saveMyWorkColumnOrder(order: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  try {
    await assertRowAffected(
      await supabase.from("profiles").update({ my_work_column_order: order }).eq("id", user.id).select("id"),
    );
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to save order" };
  }
  revalidatePath("/my-work");
  return { ok: true };
}

async function lowestStateOfCategory(supabase: Supabase, projectId: string, category: string): Promise<string | null> {
  const { data } = await supabase
    .from("project_states")
    .select("id")
    .eq("project_id", projectId)
    .eq("category", category)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function isRealCategoryDone(supabase: Supabase, stateId: string | null): Promise<boolean> {
  if (!stateId) return false; // Icebox — not reachable from My Work anyway.
  const { data } = await supabase.from("project_states").select("category").eq("id", stateId).single();
  return data?.category === "done";
}

async function nextTodayPosition(supabase: Supabase, userId: string, clientToday: string): Promise<number> {
  const { data } = await supabase
    .from("my_work_story_state")
    .select("today_position")
    .eq("user_id", userId)
    .eq("today_date", clientToday)
    .order("today_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.today_position ?? -1) + 1;
}

async function ownsColumn(supabase: Supabase, userId: string, columnId: string): Promise<boolean> {
  const { data } = await supabase
    .from("my_work_columns")
    .select("id")
    .eq("id", columnId)
    .eq("user_id", userId)
    .maybeSingle();
  return data !== null;
}

// Partial upsert: only the patched columns change on an existing row (supabase
// upsert SETs just the payload's columns on conflict), so a Today write
// preserves column_id and a free-column write preserves nothing it doesn't name.
async function persistMark(
  supabase: Supabase,
  userId: string,
  storyId: string,
  patch: { column_id?: string | null; column_position?: number | null; today_date?: string | null; today_position?: number | null },
  projectId: string,
): Promise<ActionResult> {
  const { error } = await supabase
    .from("my_work_story_state")
    .upsert(
      { user_id: userId, story_id: storyId, updated_at: new Date().toISOString(), ...patch },
      { onConflict: "user_id,story_id" },
    );
  if (error) return { ok: false, message: error.message };
  revalidatePaths(projectId, storyId);
  return { ok: true };
}

function revalidatePaths(projectId: string, storyId: string) {
  revalidatePath("/my-work");
  // A personal Todo/Done drag changed the real board too.
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${storyId}`);
}
