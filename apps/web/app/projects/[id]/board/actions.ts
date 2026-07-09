"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifySlack } from "@/lib/integrations/slack";
import { iterationDoneMessage, iterationStartedMessage, storyStateChangeMessage } from "@/lib/utils/slack";
import { BACKLOG_CONTAINER_ID, ICEBOX_CONTAINER_ID } from "@/lib/utils/board";
import {
  BACKLOG_COLUMN_ID,
  columnForStory,
  evaluateDrop,
  evaluateListDrop,
  zoneForStory,
  type KanbanColumnId,
  type ListZoneId,
} from "@/lib/utils/kanban";
import { isUnestimatedFeature, nextPosition, reorderPositions } from "@/lib/utils/stories";
import {
  applyTransition,
  shouldAssignCurrentIteration,
  type StoryState,
  type StoryTransitionAction,
} from "@/lib/utils/story-state";

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Throws on the first failed write in a batch of parallel Supabase updates
 * (TASK-22). `Promise.all` alone only rejects if a promise itself throws —
 * a Supabase update that fails (including one RLS silently filters to zero
 * rows) resolves normally with `{ error }` set, so an unchecked batch like
 * `Promise.all(ids.map(id => supabase.from(...).update(...).eq("id", id)))`
 * can partially apply and still look like a success to the caller.
 */
async function assertAllSucceeded(
  results: ReadonlyArray<{ error: { message: string } | null }>,
): Promise<void> {
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw new Error(failed.error.message);
  }
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
      .eq("project_id", projectId)
      .single();

    if (iteration?.state === "done") {
      throw new Error("Cannot move a story into a finalized iteration");
    }
  }

  const { data: story } = await supabase
    .from("stories")
    .select("state")
    .eq("id", storyId)
    .eq("project_id", projectId)
    .single();

  const update: { iteration_id: string | null; state?: StoryState } = {
    iteration_id: destinationIterationId,
  };
  if (isIcebox) {
    update.state = "unscheduled";
  } else if (story?.state === "unscheduled") {
    update.state = "unstarted";
  }

  const { error } = await supabase
    .from("stories")
    .update(update)
    .eq("id", storyId)
    .eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  if (orderedIds.length > 0) {
    await assertAllSucceeded(
      await Promise.all(
        reorderPositions(orderedIds).map(({ id, position }) =>
          supabase.from("stories").update({ position }).eq("id", id).eq("project_id", projectId),
        ),
      ),
    );
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Creates a story from a column's inline quick-add composer (see
 * spec/screens.md "Board layout": title only, defaults for everything else —
 * type `feature`, unestimated, unassigned). `target` decides where it lands:
 * `backlog` (unstarted, no iteration), `icebox` (unscheduled), or
 * `unstarted` (scheduled into the current iteration).
 */
export async function quickCreateStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const target = String(formData.get("target"));

  if (!title) {
    return;
  }

  const supabase = await createClient();

  const [{ data: existing }, { data: currentRows }] = await Promise.all([
    supabase.from("stories").select("position").eq("project_id", projectId),
    target === "unstarted"
      ? supabase
          .from("iterations")
          .select("id")
          .eq("project_id", projectId)
          .neq("state", "done")
          .order("number", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ]);

  let iterationId: string | null = null;
  if (target === "unstarted") {
    iterationId = currentRows?.[0]?.id ?? null;
    if (!iterationId) {
      throw new Error("No active iteration");
    }
  }

  const { error } = await supabase.from("stories").insert({
    project_id: projectId,
    title,
    story_type: "feature",
    state: target === "icebox" ? "unscheduled" : "unstarted",
    iteration_id: iterationId,
    position: nextPosition(existing ?? []),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * Free-mode quick-add (Task 14): creates a story directly in a custom
 * status column. `stories.state` stays at its default and is ignored in
 * free mode — the column is `custom_status_id`.
 */
export async function quickCreateStoryFree(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const statusId = String(formData.get("status_id"));

  if (!title) {
    return;
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from("stories").select("position").eq("project_id", projectId);

  // The composite FK also rejects a status of another project — this check
  // just turns that into a readable error.
  const { data: status } = await supabase
    .from("custom_statuses")
    .select("id")
    .eq("id", statusId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!status) {
    throw new Error("Unknown status for this project");
  }

  const { error } = await supabase.from("stories").insert({
    project_id: projectId,
    title,
    story_type: "feature",
    custom_status_id: statusId,
    position: nextPosition(existing ?? []),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * Free-mode drop (Task 14): any story may move to any of the project's
 * custom statuses — there is no state machine to validate against. Also
 * persists the order within the target column, and notifies Slack with the
 * status name (the free-mode equivalent of a state change).
 */
export async function dropStoryFree(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const statusId = String(formData.get("status_id"));
  const orderedIds = formData.getAll("ordered_ids").map(String).filter(Boolean);

  const supabase = await createClient();

  const [{ data: story, error: fetchError }, { data: status }] = await Promise.all([
    supabase
      .from("stories")
      .select("number, title, custom_status_id")
      .eq("id", storyId)
      .eq("project_id", projectId)
      .single(),
    supabase.from("custom_statuses").select("id, name").eq("id", statusId).eq("project_id", projectId).maybeSingle(),
  ]);

  if (fetchError || !story) {
    throw new Error(fetchError?.message ?? "Story not found");
  }
  if (!status) {
    throw new Error("Unknown status for this project");
  }

  if (story.custom_status_id !== statusId) {
    const { error } = await supabase.from("stories").update({ custom_status_id: statusId }).eq("id", storyId);
    if (error) {
      throw new Error(error.message);
    }
    after(() => notifySlack(projectId, storyStateChangeMessage(story, status.name)));
  }

  if (orderedIds.length > 0) {
    await assertAllSucceeded(
      await Promise.all(
        reorderPositions(orderedIds).map(({ id, position }) =>
          supabase.from("stories").update({ position }).eq("id", id).eq("project_id", projectId),
        ),
      ),
    );
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${storyId}`);
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
      .select("number, title, state, story_type, points, iteration_id")
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
    const { error } = await supabase
      .from("stories")
      .update(update)
      .eq("id", storyId)
      .eq("project_id", projectId);
    if (error) {
      throw new Error(error.message);
    }
    if (evaluation.state) {
      const newState = evaluation.state;
      after(() => notifySlack(projectId, storyStateChangeMessage(story, newState)));
    }
  }

  if (orderedIds.length > 0) {
    await assertAllSucceeded(
      await Promise.all(
        reorderPositions(orderedIds).map(({ id, position }) =>
          supabase.from("stories").update({ position }).eq("id", id).eq("project_id", projectId),
        ),
      ),
    );
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/stories/${storyId}`);
}

/**
 * Handles a List-view drop (see spec/screens.md "Board layout: List view"),
 * the flat-list counterpart to `dropStory`. List view merges every
 * current-iteration state into one "current" zone, so reorders always
 * persist across the whole destination zone rather than a single state's
 * column — otherwise a reorder spanning two states would look like an
 * (invalid) attempted state transition to `evaluateDrop`.
 *
 * The dragged item can be a story or a freeform backlog divider
 * (`item_kind`) — a divider never changes state/iteration, only its
 * position, and can only be reordered within the Backlog zone. `ordered_ids`
 * entries are `"story:<id>"` / `"divider:<id>"` pairs (Backlog can mix both;
 * Current/Icebox only ever contain stories) so positions are written to the
 * right table — see `lib/utils/iterations.ts` "buildBacklogRows" for why the
 * two tables' positions must interleave consistently.
 */
export async function dropStoryInList(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const itemKind = String(formData.get("item_kind") ?? "story");
  const itemId = String(formData.get("item_id"));
  const targetZone = String(formData.get("target_zone")) as ListZoneId;
  const orderedItems = formData.getAll("ordered_ids").map(String).filter(Boolean);

  const supabase = await createClient();

  if (itemKind === "divider") {
    if (targetZone !== BACKLOG_COLUMN_ID) {
      throw new Error("Dividers can only be reordered within the backlog");
    }
  } else {
    const [{ data: story, error: fetchError }, { data: currentRows }] = await Promise.all([
      supabase
        .from("stories")
        .select("number, title, state, story_type, points, iteration_id")
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
    ]);

    if (fetchError || !story) {
      throw new Error(fetchError?.message ?? "Story not found");
    }

    const currentIterationId = currentRows?.[0]?.id ?? null;
    if (!currentIterationId) {
      throw new Error("No active iteration");
    }

    const from = zoneForStory(story, currentIterationId);
    const evaluation = evaluateListDrop(story, from, targetZone);
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
      const { error } = await supabase
        .from("stories")
        .update(update)
        .eq("id", itemId)
        .eq("project_id", projectId);
      if (error) {
        throw new Error(error.message);
      }
      if (evaluation.state) {
        const newState = evaluation.state;
        after(() => notifySlack(projectId, storyStateChangeMessage(story, newState)));
      }
    }
  }

  if (orderedItems.length > 0) {
    await persistBacklogOrder(supabase, projectId, orderedItems);
  }

  revalidatePath(`/projects/${projectId}/board`);
  if (itemKind !== "divider") {
    revalidatePath(`/stories/${itemId}`);
  }
}

/**
 * Writes positions for a full ordered backlog sequence — `entries` are
 * `"story:<id>"` / `"divider:<id>"` pairs, in final display order — to the
 * right table per item. Shared by `dropStoryInList` (drag reorder) and
 * `createBacklogDivider` (inserting a new row at an exact spot), since both
 * need to resequence the *entire* zone together (see
 * `lib/utils/iterations.ts` "buildBacklogRows": stories and dividers share
 * one dense position sequence within the backlog).
 */
async function persistBacklogOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  entries: ReadonlyArray<string>,
) {
  const storyUpdates: { id: string; position: number }[] = [];
  const dividerUpdates: { id: string; position: number }[] = [];
  entries.forEach((entry, position) => {
    const separator = entry.indexOf(":");
    const kind = entry.slice(0, separator);
    const id = entry.slice(separator + 1);
    (kind === "divider" ? dividerUpdates : storyUpdates).push({ id, position });
  });

  await assertAllSucceeded(
    await Promise.all([
      ...storyUpdates.map(({ id, position }) =>
        supabase.from("stories").update({ position }).eq("id", id).eq("project_id", projectId),
      ),
      ...dividerUpdates.map(({ id, position }) =>
        supabase.from("backlog_dividers").update({ position }).eq("id", id).eq("project_id", projectId),
      ),
    ]),
  );
}

/**
 * Fetches the backlog's current stories + dividers together, sorted by
 * their shared position sequence — the same merge `board/page.tsx` does
 * server-side to build the List view's initial row order (see
 * `lib/utils/iterations.ts` "buildBacklogRows").
 *
 * TASK-19: matches `zoneForStory`'s actual backlog definition (not
 * unscheduled, no iteration assigned) rather than the narrower
 * `state = "unstarted"` this used to require — that excluded a stray
 * story left `started` with `iteration_id: null` (see `transitionStory`)
 * from this order entirely, so `before_item_id` lookups for it always
 * missed (`findIndex` = -1) and new dividers silently appended at the end
 * instead of landing where the user dropped them.
 */
async function fetchBacklogOrder(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string) {
  const [{ data: stories }, { data: dividers }] = await Promise.all([
    supabase
      .from("stories")
      .select("id, position")
      .eq("project_id", projectId)
      .neq("state", "unscheduled")
      .is("iteration_id", null),
    supabase.from("backlog_dividers").select("id, position").eq("project_id", projectId),
  ]);

  return [
    ...(stories ?? []).map((s) => ({ kind: "story" as const, id: s.id, position: s.position })),
    ...(dividers ?? []).map((d) => ({ kind: "divider" as const, id: d.id, position: d.position })),
  ].sort((a, b) => a.position - b.position);
}

/**
 * Creates a freeform planning row (see spec/screens.md "Board layout: List
 * view") at an exact spot in the backlog — immediately before
 * `before_item_id` (a `"story:<id>"` / `"divider:<id>"` pair), or at the end
 * if omitted — rather than always appending and relying on a follow-up drag.
 * `kind` distinguishes a cosmetic `note` (needs a label) from an
 * `iteration_break` (forces a velocity-group boundary there, see
 * `lib/utils/iterations.ts` "buildBacklogRows"; no label required).
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
  const merged = await fetchBacklogOrder(supabase, projectId);

  const { data: created, error: insertError } = await supabase
    .from("backlog_dividers")
    .insert({ project_id: projectId, label, kind, position: merged.length })
    .select("id")
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message ?? "Failed to create divider");
  }

  const beforeIndex = beforeItemId ? merged.findIndex((item) => `${item.kind}:${item.id}` === beforeItemId) : -1;
  const insertAt = beforeIndex >= 0 ? beforeIndex : merged.length;
  const ordered = merged.map((item) => `${item.kind}:${item.id}`);
  ordered.splice(insertAt, 0, `divider:${created.id}`);

  await persistBacklogOrder(supabase, projectId, ordered);

  revalidatePath(`/projects/${projectId}/board`);
}

export async function deleteBacklogDivider(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const dividerId = String(formData.get("divider_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("backlog_dividers")
    .delete()
    .eq("id", dividerId)
    .eq("project_id", projectId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * Applies a one-click state-transition button (Start / Finish / Deliver /
 * Accept / Reject / Restart — see spec/screens.md "Story card UX"). Reads
 * the story's current state server-side rather than trusting the client so
 * a stale card can't force an invalid jump.
 *
 * TASK-19: the List view renders this button on every row, including
 * Backlog ones (a backlog story is `unstarted`, whose only action is
 * Start) — so unlike the physical Kanban board, this can transition a
 * story that has no iteration assigned yet. Starting/restarting such a
 * story also assigns it to the current iteration (shouldAssignCurrentIteration),
 * matching what dragging it into the current zone already does; otherwise
 * it ends up `started` with `iteration_id: null` — invisible to velocity,
 * never carried by rollover, and undraggable back to Backlog/Icebox.
 */
export async function transitionStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const storyId = String(formData.get("story_id"));
  const action = String(formData.get("action")) as StoryTransitionAction;

  const supabase = await createClient();
  const [{ data: story, error: fetchError }, { data: currentRows }] = await Promise.all([
    supabase
      .from("stories")
      .select("number, title, state, story_type, points, iteration_id")
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
  ]);

  if (fetchError || !story) {
    throw new Error(fetchError?.message ?? "Story not found");
  }

  const nextState = applyTransition(story.state as StoryState, action);

  // An unestimated feature cannot be started (see spec/features.md) — this
  // covers both Start and Restart, whose target state is `started`.
  if (nextState === "started" && isUnestimatedFeature(story.story_type, story.points)) {
    throw new Error("An unestimated feature cannot be started");
  }

  const update: { state: StoryState; iteration_id?: string } = { state: nextState };
  if (shouldAssignCurrentIteration(nextState, Boolean(story.iteration_id))) {
    const currentIterationId = currentRows?.[0]?.id;
    if (!currentIterationId) {
      throw new Error("No active iteration");
    }
    update.iteration_id = currentIterationId;
  }

  const { error } = await supabase
    .from("stories")
    .update(update)
    .eq("id", storyId)
    .eq("project_id", projectId);
  if (error) {
    throw new Error(error.message);
  }

  after(() => notifySlack(projectId, storyStateChangeMessage(story, nextState)));

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/stories/${storyId}`);
}

type FinalizeIterationEvent =
  | { kind: "finalized"; number: number; velocity: number }
  | { kind: "started"; number: number; start_date: string; end_date: string };

function parseFinalizeEvents(raw: unknown): FinalizeIterationEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (event): event is FinalizeIterationEvent =>
      typeof event === "object" && event !== null && "kind" in event,
  );
}

// Replays the ordered events a finalize_iteration call reports (TASK-10) as
// the same Slack notifications the old per-loop-iteration TS logic fired —
// one per finalized/started iteration, in order, so a multi-sprint catch-up
// doesn't lose the intermediate ones the way just diffing before/after
// iteration numbers would.
function notifyFinalizeEvents(projectId: string, events: FinalizeIterationEvent[]) {
  for (const event of events) {
    if (event.kind === "finalized") {
      after(() => notifySlack(projectId, iterationDoneMessage(event.number, event.velocity)));
    } else {
      after(() => notifySlack(projectId, iterationStartedMessage(event.number, event.start_date, event.end_date)));
    }
  }
}

/**
 * Lazily keeps a project's current iteration row up to date (see
 * spec/velocity.md "Automatic scheduling & rollover"). Called on first
 * access from every view that reads iterations, before it queries them —
 * open to any project member, including viewers, since it's system
 * maintenance triggered by reads.
 *
 * TASK-10: the actual finalize/rollover work lives in the shared
 * `finalize_iteration` SECURITY DEFINER RPC (advisory-locked, idempotent —
 * spec/velocity.md "Finalization concurrency"), not here. This wrapper does
 * a cheap pre-check so an already-current project skips the RPC call (and
 * its advisory lock) on every page load, then replays whatever events the
 * RPC reports as Slack notifications.
 */
export async function ensureCurrentIteration(projectId: string) {
  const supabase = await createClient();
  const today = todayDateOnly();

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
 * "Finish iteration" button (owner/member, spec/velocity.md "Manual
 * finish"): closes the current iteration early via the same
 * `finalize_iteration` RPC with `p_manual: true`, which truncates
 * `end_date` to today before finalizing. A double-click or a lazy rollover
 * racing this call is safe — the RPC's advisory lock serializes them and a
 * call that finds nothing left to finish returns no events.
 */
export async function finishIteration(formData: FormData) {
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finalize_iteration", {
    p_project_id: projectId,
    p_manual: true,
  });
  if (error) {
    throw new Error(error.message);
  }

  notifyFinalizeEvents(projectId, parseFinalizeEvents(data));

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
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
 * edited inline on its Backlog group header (Task 9, spec/screens.md
 * "Backlog groups"). `iteration_goals.goal` is NOT NULL, so an empty commit
 * deletes the row outright rather than storing an empty string — adopted
 * into the real `iterations.goal` on rollover (see `ensureCurrentIteration`
 * above) once that number's row is created.
 */
export async function upsertIterationGoal(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const number = Number(formData.get("number"));
  const goal = String(formData.get("goal") ?? "").trim();

  const supabase = await createClient();

  const { error } = goal
    ? await supabase.from("iteration_goals").upsert({ project_id: projectId, number, goal })
    : await supabase.from("iteration_goals").delete().eq("project_id", projectId).eq("number", number);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/board`);
}
