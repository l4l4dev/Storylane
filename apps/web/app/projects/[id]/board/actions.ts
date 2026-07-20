"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import { notifySlack } from "@/lib/integrations/slack";
import type { ActionResult, ProjectState } from "@/lib/types";
import { iterationDoneMessage, iterationStartedMessage, storyStateChangeMessage } from "@/lib/utils/slack";
import {
  BACKLOG_COLUMN_ID,
  columnForStory,
  evaluateDrop,
  evaluateListDrop,
  lowestUnstartedStateId,
  toGateStates,
  zoneForStory,
  type KanbanColumnId,
  type ListZoneId,
} from "@/lib/utils/kanban";
import { evaluateFocusDrop, type FocusDragTarget } from "@/lib/utils/focus";
import { utcTodayKey } from "@/lib/utils/format";
import { parsePoints, pointScaleValues } from "@/lib/utils/stories";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Every state in the project, ordered by position (kept small — a handful of rows per project). */
async function fetchProjectStates(supabase: SupabaseServerClient, projectId: string): Promise<ProjectState[]> {
  const { data, error } = await supabase
    .from("project_states")
    .select("id, project_id, name, action_label, category, position, created_at")
    .eq("project_id", projectId)
    .order("position");
  if (error) throw new Error(`Could not read project states: ${error.message}`);
  return (data ?? []) as ProjectState[];
}

/** A state_id's display name for Slack messages ("Icebox" for null, "Unknown" for a stale/foreign id). */
function stateName(stateId: string | null, states: ReadonlyArray<ProjectState>): string {
  if (stateId === null) return "Icebox";
  return states.find((s) => s.id === stateId)?.name ?? "Unknown";
}

// Single UTC date convention shared with the DB — see utcTodayKey.

// TASK-56: the three board drop paths (dropStory / setStoryFocus /
// dropStoryInList) are thin callers of move_story_board, the
// single transactional move+reorder RPC (20260715000008). Each still reads the
// story and runs the same pure evaluate* validation server-side (never trust
// the client), then hands the RPC an intent — deltas + an expected snapshot +
// a "before" anchor — and the RPC applies the column change and dense reorder
// atomically under one advisory lock. Shared plumbing lives here.

const STALE_MOVE_MESSAGE = "This story changed on the board. Refresh and try again.";

// Every zone-determining column, snapshotted from the action's trusted read.
// The RPC re-reads these FOR UPDATE and rejects (P0001 "stale") if any moved
// between this read and the locked write — closing that TOCTOU window.
function moveExpected(row: {
  state_id: string | null;
  iteration_id: string | null;
  focus: string | null;
}) {
  return {
    state_id: row.state_id,
    iteration_id: row.iteration_id,
    focus: row.focus,
  };
}

// The client's "before" anchor ("story:<id>" / "divider:<id>"; absent = append
// to the zone's end) into the RPC's p_anchor shape.
function moveAnchor(beforeItemId: string | null): { before?: { kind: string; id: string } } {
  if (!beforeItemId) {
    return {};
  }
  const separator = beforeItemId.indexOf(":");
  return { before: { kind: beforeItemId.slice(0, separator), id: beforeItemId.slice(separator + 1) } };
}

// The RPC raises P0001 for BOTH a stale snapshot and "no active iteration";
// only a stale snapshot is a refresh cue, distinguished by its message. Anything
// else (P0002 not-found, 42501 not-authorized, …) surfaces its own message.
function moveErrorMessage(error: { code?: string; message: string }): string {
  return error.code === "P0001" && error.message.includes("stale") ? STALE_MOVE_MESSAGE : error.message;
}

/**
 * Creates a story from a column's inline quick-add composer (see
 * spec/screens.md "Board layout": title only, defaults for everything else —
 * type `feature`, unestimated, unassigned). `target` decides where it lands:
 * `backlog` (unstarted, no iteration), `icebox` (unscheduled), or
 * `unstarted` (scheduled into the current iteration).
 *
 * `backlog` additionally accepts `before_item_id` (TASK-36, same
 * `"story:<id>"` / `"divider:<id>"` convention as `createBacklogDivider`) so
 * the List view's per-virtual-iteration-group composer can land the new
 * story at that group's bottom instead of always the whole backlog's. The
 * insert + reposition run atomically in the `insert_board_item` RPC (TASK-51),
 * shared with `createBacklogDivider`.
 */
export async function quickCreateStory(formData: FormData): Promise<ActionResult> {
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const target = String(formData.get("target"));

  if (!title) {
    return { ok: true };
  }

  const supabase = await createClient();

  if (target === "backlog") {
    const beforeItemId = String(formData.get("before_item_id") ?? "") || null;

    const { error } = await supabase.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "story",
      p_payload: { title },
      p_anchor: moveAnchor(beforeItemId),
    });
    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath(`/projects/${projectId}/board`);
    return { ok: true };
  }

  let iterationId: string | null = null;
  let stateId: string | null = null;
  if (target === "unstarted") {
    const { data: currentRows } = await supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .order("number", { ascending: false })
      .limit(1);
    iterationId = currentRows?.[0]?.id ?? null;
    if (!iterationId) {
      return { ok: false, message: "No active iteration" };
    }
    const states = await fetchProjectStates(supabase, projectId);
    stateId = lowestUnstartedStateId(toGateStates(states));
    if (!stateId) {
      return { ok: false, message: "This project has no unstarted state to create stories in" };
    }
  }
  // target === "icebox" (or anything else): stateId/iterationId stay null.

  const { error } = await supabase.from("stories").insert({
    project_id: projectId,
    title,
    story_type: "feature",
    state_id: stateId,
    iteration_id: iterationId,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/projects/${projectId}/board`);
  return { ok: true };
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
  const beforeItemId = String(formData.get("before_item_id") ?? "") || null;

  const supabase = await createClient();

  const [{ data: story, error: fetchError }, { data: currentRows }, states] = await Promise.all([
    supabase
      .from("stories")
      .select("number, title, state_id, story_type, points, iteration_id, focus")
      .eq("id", storyId)
      .eq("project_id", projectId)
      .single(),
    supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .order("number", { ascending: false })
      .limit(1),
    fetchProjectStates(supabase, projectId),
  ]);

  if (fetchError || !story) {
    throw new Error(fetchError?.message ?? "Story not found");
  }

  const currentIterationId = currentRows?.[0]?.id ?? null;
  if (!currentIterationId) {
    throw new Error("No active iteration");
  }

  const gateStates = toGateStates(states);
  const from = columnForStory(story, currentIterationId);
  const evaluation = evaluateDrop(story, from, targetColumn, gateStates);
  if (!evaluation.ok) {
    throw new Error(evaluation.reason);
  }

  const deltas = trackerDeltas(evaluation);

  const { error } = await supabase.rpc("move_story_board", {
    p_project_id: projectId,
    p_item: { kind: "story", id: storyId },
    p_view: "tracker",
    p_expected: moveExpected(story),
    p_deltas: deltas,
    p_anchor: moveAnchor(beforeItemId),
  });
  if (error) {
    throw new Error(moveErrorMessage(error));
  }

  if ("state_id" in evaluation) {
    const newName = stateName(evaluation.state_id ?? null, states);
    after(() => notifySlack(projectId, storyStateChangeMessage(story, newName)));
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${storyId}`);
}

// State/iteration deltas from an evaluateDrop/evaluateListDrop result. The RPC
// re-resolves iteration='current' to the latest non-done iteration under its
// lock, so the id is never passed from here (a concurrent rollover would make
// a client-resolved id stale). Presence, not truthiness: `state_id` can
// legitimately be `null` (an Icebox target), which is falsy but a real delta
// — checking `"state_id" in evaluation` distinguishes that from the key
// being absent entirely (no state change).
function trackerDeltas(evaluation: {
  state_id?: string | null;
  iteration: "current" | "none" | "keep";
}): { state_id?: string | null; iteration?: "current" | "none" } {
  const deltas: { state_id?: string | null; iteration?: "current" | "none" } = {};
  if ("state_id" in evaluation) {
    deltas.state_id = evaluation.state_id;
  }
  if (evaluation.iteration !== "keep") {
    deltas.iteration = evaluation.iteration;
  }
  return deltas;
}

/**
 * Handles a Focus-view drop between Todo / Today (spec/screens.md
 * "Focus view"). Unlike `dropStory`, this only ever sets or
 * clears `focus` — state and iteration_id are never touched here; state
 * changes go through the on-card transition buttons instead.
 */
export async function setStoryFocus(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const target = String(formData.get("target")) as FocusDragTarget;
  const beforeItemId = String(formData.get("before_item_id") ?? "") || null;

  const supabase = await createClient();

  const [{ data: story, error: fetchError }, { data: currentRows }, states] = await Promise.all([
    supabase
      .from("stories")
      .select("state_id, iteration_id, focus")
      .eq("id", storyId)
      .eq("project_id", projectId)
      .single(),
    supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .order("number", { ascending: false })
      .limit(1),
    fetchProjectStates(supabase, projectId),
  ]);

  if (fetchError || !story) {
    throw new Error(fetchError?.message ?? "Story not found");
  }

  const currentIterationId = currentRows?.[0]?.id ?? null;
  if (!currentIterationId || story.iteration_id !== currentIterationId) {
    throw new Error("Story is not in the current iteration");
  }

  const category = story.state_id === null ? null : (states.find((s) => s.id === story.state_id)?.category ?? null);
  const evaluation = evaluateFocusDrop({ category }, target);
  if (!evaluation.ok) {
    throw new Error(evaluation.reason);
  }

  const { error } = await supabase.rpc("move_story_board", {
    p_project_id: projectId,
    p_item: { kind: "story", id: storyId },
    p_view: "focus",
    p_expected: moveExpected(story),
    p_deltas: { focus: evaluation.focus },
    p_anchor: moveAnchor(beforeItemId),
  });
  if (error) {
    throw new Error(moveErrorMessage(error));
  }

  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * Handles a List-view drop (see spec/screens.md "Board layout: List view"),
 * the flat-list counterpart to `dropStory`. List view merges every
 * current-iteration state into one "current" zone; the RPC derives that zone
 * from the story's post-delta columns, so a reorder spanning two states no
 * longer looks like an (invalid) attempted state transition.
 *
 * The dragged item can be a story or a freeform backlog divider
 * (`item_kind`) — a divider never changes state/iteration, only its position,
 * and can only be reordered within the Backlog zone. The `before_item_id`
 * anchor is a `"story:<id>"` / `"divider:<id>"` pair (Backlog can mix both;
 * Current/Icebox only ever contain stories) so the RPC splices it into the
 * right table — see `lib/utils/iterations.ts` "buildBacklogRows" for why the
 * two tables' positions must interleave consistently.
 */
export async function dropStoryInList(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const itemKind = String(formData.get("item_kind") ?? "story");
  const itemId = String(formData.get("item_id"));
  const targetZone = String(formData.get("target_zone")) as ListZoneId;
  const beforeItemId = String(formData.get("before_item_id") ?? "") || null;

  const supabase = await createClient();

  // A divider only ever reorders within the Backlog zone — it carries no
  // state/iteration, so the RPC gets empty deltas + an empty expected snapshot
  // (the RPC skips the stale guard for a divider) and just resequences the
  // two-table backlog.
  if (itemKind === "divider") {
    if (targetZone !== BACKLOG_COLUMN_ID) {
      throw new Error("Dividers can only be reordered within the backlog");
    }

    const { error } = await supabase.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "divider", id: itemId },
      p_view: "list",
      p_expected: {},
      p_deltas: {},
      p_anchor: moveAnchor(beforeItemId),
    });
    if (error) {
      throw new Error(moveErrorMessage(error));
    }

    revalidatePath(`/projects/${projectId}/board`);
    return;
  }

  const [{ data: story, error: fetchError }, { data: currentRows }, states] = await Promise.all([
    supabase
      .from("stories")
      .select("number, title, state_id, story_type, points, iteration_id, focus")
      .eq("id", itemId)
      .eq("project_id", projectId)
      .single(),
    supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .order("number", { ascending: false })
      .limit(1),
    fetchProjectStates(supabase, projectId),
  ]);

  if (fetchError || !story) {
    throw new Error(fetchError?.message ?? "Story not found");
  }

  const currentIterationId = currentRows?.[0]?.id ?? null;
  if (!currentIterationId) {
    throw new Error("No active iteration");
  }

  const gateStates = toGateStates(states);
  const from = zoneForStory(story, currentIterationId);
  const evaluation = evaluateListDrop(story, from, targetZone, gateStates);
  if (!evaluation.ok) {
    throw new Error(evaluation.reason);
  }

  const { error } = await supabase.rpc("move_story_board", {
    p_project_id: projectId,
    p_item: { kind: "story", id: itemId },
    p_view: "list",
    p_expected: moveExpected(story),
    p_deltas: trackerDeltas(evaluation),
    p_anchor: moveAnchor(beforeItemId),
  });
  if (error) {
    throw new Error(moveErrorMessage(error));
  }

  if ("state_id" in evaluation) {
    const newName = stateName(evaluation.state_id ?? null, states);
    after(() => notifySlack(projectId, storyStateChangeMessage(story, newName)));
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${itemId}`);
}

/**
 * Creates a freeform planning row (see spec/screens.md "Board layout: List
 * view") at an exact spot in the backlog — immediately before
 * `before_item_id` (a `"story:<id>"` / `"divider:<id>"` pair), or at the end
 * if omitted — rather than always appending and relying on a follow-up drag.
 * `kind` distinguishes a cosmetic `note` (needs a label) from an
 * `iteration_break` (forces a velocity-group boundary there, see
 * `lib/utils/iterations.ts` "buildBacklogRows"; no label required).
 *
 * The insert + reposition run atomically in the `insert_board_item` RPC
 * (TASK-51), shared with `quickCreateStory`'s backlog branch — stories and
 * dividers share one dense position sequence, so the RPC interleaves them.
 */
export async function createBacklogDivider(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const label = String(formData.get("label") ?? "").trim();
  const kind = String(formData.get("kind") ?? "note") as "note" | "iteration_break";
  const beforeItemId = String(formData.get("before_item_id") ?? "") || null;

  if (kind === "note" && !label) {
    return;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("insert_board_item", {
    p_project_id: projectId,
    p_kind: "divider",
    p_payload: { label, kind },
    p_anchor: moveAnchor(beforeItemId),
  });
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
}

export async function deleteBacklogDivider(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const dividerId = String(formData.get("divider_id"));

  const supabase = await createClient();
  await assertRowAffected(
    await supabase.from("backlog_dividers").delete().eq("id", dividerId).eq("project_id", projectId).select("id"),
  );

  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * Applies a one-click state-transition button (advance / Accept / Reject /
 * Restart — see spec/screens.md "Story card UX"). The client resolves the
 * target `state_id` itself via `computeStateGate` (packages/core) — the
 * button's own available-targets computation — and this action just
 * delegates the actual write, plus the shared guards (estimation gate,
 * done-iteration guard, start-from-backlog current-iteration assignment), to
 * the `set_story_state` RPC — the same enforcement point the MCP server
 * uses, so the rule can't drift between clients (spec/mcp.md). The RPC
 * re-derives the story's project internally and is gated by the stories
 * UPDATE RLS policy, so a stale/forged project_id in the form can't
 * misdirect the write; the initial read here is only to scope this action's
 * own error and Slack notification to the expected project.
 *
 * The List view renders this button on every row, including Backlog ones (a
 * backlog story is unstarted-category, whose only action is the first
 * advance) — so unlike the physical Kanban board, this can transition a
 * story that has no iteration assigned yet. The RPC schedules it into the
 * current iteration in that case, matching what dragging it into the
 * current zone already does.
 */
export async function setStoryState(formData: FormData): Promise<ActionResult> {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const stateIdRaw = String(formData.get("state_id") ?? "");
  const stateId = stateIdRaw === "" ? null : stateIdRaw;

  const supabase = await createClient();
  const { data: story, error: fetchError } = await supabase
    .from("stories")
    .select("number, title")
    .eq("id", storyId)
    .eq("project_id", projectId)
    .single();
  if (fetchError || !story) {
    return { ok: false, message: fetchError?.message ?? "Story not found" };
  }

  // The generated RPC Args type marks p_state_id non-null — a known codegen
  // gap (see app/stories/[id]/actions.ts's update_story call for the same
  // pattern) even though set_story_state's SQL body accepts null (Icebox).
  const { data, error } = await supabase.rpc("set_story_state", {
    p_story_id: storyId,
    p_state_id: stateId as string,
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  const newStateId = (data as { state_id: string | null }).state_id;

  const states = await fetchProjectStates(supabase, projectId);
  after(() => notifySlack(projectId, storyStateChangeMessage(story, stateName(newStateId, states))));

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/stories/${storyId}`);
  return { ok: true };
}

/**
 * Estimates an unstarted/rejected unestimated feature (TASK-37, Pivotal
 * Tracker parity — spec/features.md): replaces the blocked Start/Restart
 * button with the project's point-scale buttons, one click each. Only sets
 * `points` — never `state`, so estimating never auto-starts the story (the
 * normal Start/Restart button appears as the follow-up click).
 */
export async function estimateStory(formData: FormData): Promise<ActionResult> {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const rawPoints = formData.get("points");

  const supabase = await createClient();
  const [{ data: story, error: fetchError }, { data: project }] = await Promise.all([
    supabase
      .from("stories")
      .select("story_type, points")
      .eq("id", storyId)
      .eq("project_id", projectId)
      .single(),
    supabase.from("projects").select("point_scale, custom_points").eq("id", projectId).single(),
  ]);

  if (fetchError || !story) {
    return { ok: false, message: fetchError?.message ?? "Story not found" };
  }

  // The estimation picker only ever renders for a `feature` (spec/features.md
  // — bug/chore/release never use it). A non-feature reaching this action is
  // tampering, not a race, so it's a hard error.
  if (story.story_type !== "feature") {
    return { ok: false, message: "This story is not awaiting estimation" };
  }

  // A story that already has points got there legitimately — another
  // tab/user estimated it first, or a double-click resubmitted after the
  // first one landed. Neither is an error a user caused; re-render (via
  // revalidate) shows the now-current points and the Start button that
  // follows, same as if this click had never raced (spec/ux-principles.md
  // principle 2 — no silent no-op, but also no crash for a benign race).
  if (story.points !== null) {
    revalidatePath(`/projects/${projectId}/board`);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/stories/${storyId}`);
    return { ok: true };
  }

  const allowedPoints = pointScaleValues(project?.point_scale ?? "fibonacci", project?.custom_points);
  const points = parsePoints(String(rawPoints ?? ""), story.story_type, allowedPoints);
  if (points === null) {
    return { ok: false, message: "Invalid point value" };
  }

  try {
    await assertRowAffected(
      await supabase.from("stories").update({ points }).eq("id", storyId).eq("project_id", projectId).select("id"),
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to estimate story",
    };
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/stories/${storyId}`);
  return { ok: true };
}

type FinalizeIterationEvent =
  // `capacity` is optional because parseFinalizeEvents validates only
  // `kind`: a payload from a finalize_iteration older than the capacity
  // snapshot has no such field, and iterationDoneMessage handles its
  // absence rather than pretending the value is always there.
  | { kind: "finalized"; number: number; velocity: number; capacity?: number; skipped?: boolean }
  | { kind: "started"; number: number; start_date: string; end_date: string }
  // A manual finish that changed nothing (nothing to finish, or the named
  // iteration was already finished by a racing/double call). Surfaced to the
  // user instead of silence — spec/ux-principles.md principle 2.
  | { kind: "noop"; reason: "nothing_to_finish" | "already_finished" };

function parseFinalizeEvents(raw: unknown): FinalizeIterationEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (event): event is FinalizeIterationEvent =>
      typeof event === "object" && event !== null && "kind" in event,
  );
}

// Replays the ordered events a finalize_iteration call reports as Slack
// notifications — one per finalized/started iteration, in order, so a
// multi-sprint catch-up doesn't lose the intermediate ones the way just
// diffing before/after iteration numbers would.
function notifyFinalizeEvents(projectId: string, events: FinalizeIterationEvent[]) {
  for (const event of events) {
    if (event.kind === "finalized") {
      after(() => notifySlack(projectId, iterationDoneMessage(event.number, event.velocity, event.capacity)));
    } else if (event.kind === "started") {
      after(() => notifySlack(projectId, iterationStartedMessage(event.number, event.start_date, event.end_date)));
    }
    // 'noop' events carry no state change — nothing to notify.
  }
}

/**
 * Lazily keeps a project's current iteration row up to date (see
 * spec/velocity.md "Automatic scheduling & rollover"). Called on first
 * access from every view that reads iterations, before it queries them —
 * open to any project member, including viewers, since it's system
 * maintenance triggered by reads.
 *
 * The actual finalize/rollover work lives in the shared
 * `finalize_iteration` SECURITY DEFINER RPC (advisory-locked, idempotent —
 * spec/velocity.md "Finalization concurrency"), not here. This wrapper does
 * a cheap pre-check so an already-current project skips the RPC call (and
 * its advisory lock) on every page load, then replays whatever events the
 * RPC reports as Slack notifications.
 */
export async function ensureCurrentIteration(projectId: string) {
  const supabase = await createClient();
  const today = utcTodayKey();

  const { data: latestRows } = await supabase
    .from("iterations")
    .select("state, end_date")
    .eq("project_id", projectId)
    .order("number", { ascending: false })
    .limit(1);

  const latest = latestRows?.[0] ?? null;
  if (latest && latest.state !== "done" && latest.end_date >= today) {
    return;
  }

  const { data, error } = await supabase.rpc("finalize_iteration", {
    p_project_id: projectId,
    p_manual: false,
  });
  if (error) {
    throw new Error(error.message);
  }

  notifyFinalizeEvents(projectId, parseFinalizeEvents(data));
}

/**
 * "Finish iteration" button (owner/member, spec/velocity.md "Manual finish"
 * / "Skipping a not-yet-started iteration"): closes the current iteration
 * early via the shared `finalize_iteration` RPC with `p_manual: true`. A
 * started iteration has its `end_date` truncated to today; a not-yet-started
 * one is skipped. `iteration_id` makes the finish target-explicit — the RPC
 * acts only if that id is still the project's latest, non-done row, so a
 * double-click or a lazy rollover racing this call returns a `noop` event
 * instead of cascading into the fresh successor. Returns the RPC's events so
 * the caller can surface visible feedback for every outcome (principle 2).
 */
export async function finishIteration(formData: FormData): Promise<{ events: FinalizeIterationEvent[] }> {
  const projectId = String(formData.get("project_id"));
  const iterationId = String(formData.get("iteration_id"));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finalize_iteration", {
    p_project_id: projectId,
    p_manual: true,
    p_iteration_id: iterationId,
  });
  if (error) {
    throw new Error(error.message);
  }

  const events = parseFinalizeEvents(data);
  notifyFinalizeEvents(projectId, events);

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);

  return { events };
}

export async function updateIterationGoal(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const iterationId = String(formData.get("iteration_id"));
  const goal = String(formData.get("goal") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("iterations")
    .update({ goal })
    .eq("id", iterationId)
    .eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Sets or clears the goal for a *virtual* (not-yet-real) future iteration,
 * edited inline on its Backlog group header (spec/screens.md "Backlog
 * groups"). `iteration_goals.goal` is NOT NULL, so an empty commit
 * deletes the row outright rather than storing an empty string — adopted
 * into the real `iterations.goal` on rollover (see `ensureCurrentIteration`
 * above) once that number's row is created.
 */
export async function upsertIterationGoal(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const number = Number(formData.get("number"));
  const goal = String(formData.get("goal") ?? "").trim();

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("Invalid iteration number");
  }

  const supabase = await createClient();

  const { error } = goal
    ? await supabase.from("iteration_goals").upsert({ project_id: projectId, number, goal })
    : await supabase.from("iteration_goals").delete().eq("project_id", projectId).eq("number", number);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/board`);
}
