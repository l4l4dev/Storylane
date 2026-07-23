"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import type { ActionResult } from "@/lib/types";
import type { MyWorkColumnId } from "@/lib/utils/my-work";
import { writeErrorMessage } from "@/lib/utils/write-error";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Moves a card between My Work's columns (doc-15 "Dragging a card"). My Work is
 * a purely personal board — there is no project-board mapping. Placement rules:
 *
 *   - Personal-project stories (is_personal): Todo/Done write the REAL state
 *     via set_story_state (Done → the lowest done state, sets completed_at;
 *     Todo → the lowest unstarted state, i.e. reopen). Today and free columns
 *     stay local marks, EXCEPT a real-done card dragged there first reopens
 *     (TASK-173). The personal project's states are category-resolvable without
 *     configuration (it's ours, template known).
 *   - Team stories: every drag is a local my_work_story_state mark. Completing
 *     happens on the story's own board (Done is not writable here); the story
 *     then shows in the viewer's Done column read from its live done category
 *     (Done is a status column now, TASK-176 — no story_completions log).
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

  // Personal Done: write the real done state (single source of truth), then
  // clear local marks — the card's home is now the real board's done category.
  if (isPersonal && target === "done") {
    const stateId = await lowestStateOfCategory(supabase, story.project_id, "done");
    if (!stateId) return { ok: false, message: "This project has no done state to move the story into." };
    const { error } = await supabase.rpc("set_story_state", { p_story_id: storyId, p_state_id: stateId });
    if (error) return { ok: false, message: writeErrorMessage(error, "You don't have permission to change this story's state.") };
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

  // Personal Todo: doc-15 maps My Work's Todo to the real unstarted state, so
  // write it (single source of truth) — this also reopens a card dragged out
  // of Done — then clear local marks.
  if (isPersonal && target === "todo") {
    const stateId = await lowestStateOfCategory(supabase, story.project_id, "unstarted");
    if (!stateId) return { ok: false, message: "This project has no unstarted state to move the story into." };
    const { error } = await supabase.rpc("set_story_state", { p_story_id: storyId, p_state_id: stateId });
    if (error) return { ok: false, message: writeErrorMessage(error, "You don't have permission to change this story's state.") };
    return persistMark(
      supabase,
      user.id,
      storyId,
      { column_id: null, column_position: null, today_date: null, today_position: null },
      story.project_id,
    );
  }

  // Personal Today / free column: these are normally local overlays that DON'T
  // touch real state (doc-15). But a real-done card dragged here would keep
  // completed_at = 'done', so the page's `completed_at is null` filter drops it
  // from the next fetch and the card silently vanishes (ux-principles principle
  // 2). Reopen it to the lowest unstarted state FIRST, then fall through to
  // write the overlay mark. A personal card that isn't real-done skips this
  // untouched — its overlay is a pure local mark as before (TASK-173).
  if (isPersonal && (await isRealCategoryDone(supabase, story.state_id))) {
    const stateId = await lowestStateOfCategory(supabase, story.project_id, "unstarted");
    if (!stateId) return { ok: false, message: "This project has no unstarted state to reopen the story into." };
    const { error } = await supabase.rpc("set_story_state", { p_story_id: storyId, p_state_id: stateId });
    if (error) return { ok: false, message: writeErrorMessage(error, "You don't have permission to change this story's state.") };
    // fall through — the target's mark write below places the reopened card.
  }

  // A team story already real-done can't be moved out of Done via a local mark:
  // classification excludes real-done from active columns, so the card would
  // snap back to Done on the next refresh with no explanation (ux-principles
  // principle 2). Personal real-done is reopened by the branch above; this is
  // team-only. The client turns this rejection into a link to the story's own
  // board (principle 8: offer a way out, don't dead-end).
  if (!isPersonal && (await isRealCategoryDone(supabase, story.state_id))) {
    return {
      ok: false,
      message: "This story is completed on its project board — reopen it there to move it out of Done.",
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
  if (error) return { ok: false, message: writeErrorMessage(error, "You no longer have access to one of these stories — refresh the page.") };
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
  if (error) return { ok: false, message: writeErrorMessage(error, "You no longer have access to one of these stories — refresh the page.") };
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
 * `today_date` is named alongside `today_position` (both required together by
 * the `today_position_needs_date` check) — column_id is left untouched on
 * existing rows (a reorder never changes which free column a card belongs
 * to). Naming only today_position used to upsert a bare INSERT (violating
 * that check) whenever a card reached Today via a still-in-flight
 * setMyWorkColumn write and got reordered again before that write landed —
 * two overlapping drags are possible since runDrop doesn't block a new drag
 * on the previous one's server round trip.
 */
export async function reorderMyWorkToday(orderedStoryIds: string[], clientToday: string): Promise<ActionResult> {
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
      today_date: clientToday,
      today_position: index,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,story_id" },
  );
  if (error) return { ok: false, message: writeErrorMessage(error, "Couldn't save the new order — refresh the page and try again.") };
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Persists a manual reorder WITHIN a free column — generalizes
 * reorderMyWorkToday's approach to any user-defined column: same full
 * re-densify, same reasoning for naming `column_id` alongside
 * `column_position` (both required together by the
 * `column_position_needs_column` check); today_date is left untouched on
 * existing rows.
 */
export async function reorderMyWorkColumn(orderedStoryIds: string[], columnId: string): Promise<ActionResult> {
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
      column_id: columnId,
      column_position: index,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,story_id" },
  );
  if (error) return { ok: false, message: writeErrorMessage(error, "Couldn't save the new order — refresh the page and try again.") };
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Persists a manual reorder WITHIN a Todo project group (TASK-177).
 * `orderedStoryIds` is that group's list in its new order (the caller scopes it
 * to the dragged card's own project group). Todo is "no Today date, no free
 * column", so writing only todo_position is safe: an existing Todo row already
 * has today_date/column_id null (CHECK my_work_story_state_todo_position_needs_
 * todo passes), and a first-time row inserts with both defaulting to null.
 */
export async function reorderMyWorkTodo(orderedStoryIds: string[]): Promise<ActionResult> {
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
      todo_position: index,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,story_id" },
  );
  if (error) return { ok: false, message: writeErrorMessage(error, "Couldn't save the new order — refresh the page and try again.") };
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Persists a manual reorder WITHIN a Done date group (TASK-176).
 * `orderedStoryIds` is that date's list in its new order (the caller scopes it
 * to the dragged card's completion date). done_position has no paired
 * discriminator (Done membership is the story's live done category, not a local
 * field), so it's a plain nullable int — no today_date/column_id to name.
 */
export async function reorderMyWorkDone(orderedStoryIds: string[]): Promise<ActionResult> {
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
      done_position: index,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,story_id" },
  );
  if (error) return { ok: false, message: writeErrorMessage(error, "Couldn't save the new order — refresh the page and try again.") };
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
  if (error) return { ok: false, message: writeErrorMessage(error, "Couldn't create the column.") };
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
//
// done_position AND todo_position are always cleared: every persistMark call
// explicitly (re)places the card, so any manual Done/Todo slot it held is now
// meaningless — a card re-completed or reopened later should start unordered
// rather than inheriting a stale slot. The reset TRIGGER can't cover either
// here: Done membership isn't a local field (no done_position discriminator to
// key off), and a move-to-Done or move-to-Todo leaves today_date/column_id both
// null — the same "shape" as sitting in Todo — so the trigger's
// `today_date/column_id became non-null` condition never fires for todo_position
// on those transitions. Clearing both here is the symmetric fix (fable-advisor /
// rls-security-reviewer TASK-176: without this, Todo→Done→Todo kept a stale
// todo_position, landing the reopened card at an unpredictable old slot).
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
      { user_id: userId, story_id: storyId, updated_at: new Date().toISOString(), done_position: null, todo_position: null, ...patch },
      { onConflict: "user_id,story_id" },
    );
  if (error) return { ok: false, message: writeErrorMessage(error, "You no longer have access to this story's project — refresh the page.") };
  revalidatePaths(projectId, storyId);
  return { ok: true };
}

function revalidatePaths(projectId: string, storyId: string) {
  revalidatePath("/my-work");
  // A personal Todo/Done drag changed the real board too.
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${storyId}`);
}
