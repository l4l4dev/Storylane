import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { isValidTransition, listForState, parsePointScale, isAllowedEstimate, estimationGateBlocks } from "@storylane/core";
import { stories, type StoryList, type StoryPriority, type StoryState, type StoryType } from "../db/schema";
import { loadInProject, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity } from "./activity";
import { resolveBlockersReferencing } from "./blockers";
import { labelIds } from "./labels";
import { appendToList, listForGroup, placeInList } from "./ordering";
import { readProject } from "./projects";
import { addOwner, ensureFollowing, followerIds, ownerIds } from "./story-people";

export interface StoryRow {
  id: string;
  number: number;
  name: string;
  description: string | null;
  story_type: StoryType;
  current_state: StoryState;
  estimate: number | null;
  accepted_at: number | null;
  deadline: number | null;
  story_priority: StoryPriority;
  list: StoryList;
  position: number;
  requested_by_id: string | null;
  owner_ids: string[];
  label_ids: string[];
  follower_ids: string[];
  created_at: number;
  updated_at: number;
}

export interface StoryFilter {
  withState?: StoryState[];
  withStoryType?: StoryType[];
  withLabel?: string;
  limit?: number;
  offset?: number;
}

export interface StoryInput {
  name: string;
  description?: string | null;
  story_type?: StoryType;
  current_state?: StoryState;
  estimate?: number | null;
  deadline?: number | null;
  story_priority?: StoryPriority;
  before_id?: string | null;
  after_id?: string | null;
}

export type StoryPatch = Partial<Omit<StoryInput, "name">> & {
  name?: string;
  /** The panel the story is dropped into; in Tracker that is part of its state, not a view. */
  group?: "unscheduled" | "scheduled" | "current";
};

const COLUMNS = {
  id: stories.id,
  number: stories.number,
  name: stories.name,
  description: stories.description,
  story_type: stories.storyType,
  current_state: stories.currentState,
  estimate: stories.estimate,
  accepted_at: stories.acceptedAt,
  deadline: stories.deadline,
  story_priority: stories.storyPriority,
  list: stories.list,
  position: stories.position,
  requested_by_id: stories.requestedById,
  created_at: stories.createdAt,
  updated_at: stories.updatedAt,
};

function toRow(
  tx: ProjectTx,
  row: (typeof COLUMNS extends infer C ? { [K in keyof C]: unknown } : never) & { id: string },
): StoryRow {
  return {
    ...(row as Omit<StoryRow, "owner_ids" | "label_ids" | "follower_ids">),
    owner_ids: ownerIds(tx, row.id),
    label_ids: labelIds(tx, row.id),
    follower_ids: followerIds(tx, row.id),
  };
}

function readOne(tx: ProjectTx, storyId: string): StoryRow {
  const row = tx.tx
    .select(COLUMNS)
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return toRow(tx, row);
}

export function readStory(tx: ProjectTx, storyId: string): StoryRow {
  return readOne(tx, storyId);
}

export function listStories(tx: ProjectTx, filter: StoryFilter = {}): StoryRow[] {
  const conditions: SQL[] = [eq(stories.projectId, tx.projectId)];
  if (filter.withState?.length) conditions.push(inArray(stories.currentState, filter.withState));
  if (filter.withStoryType?.length) conditions.push(inArray(stories.storyType, filter.withStoryType));
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 500);
  const rows = tx.tx
    .select(COLUMNS)
    .from(stories)
    .where(and(...conditions))
    .orderBy(stories.list, stories.position)
    .limit(limit)
    .offset(filter.offset ?? 0)
    .all();
  return rows.map((row) => toRow(tx, row));
}

function requesterId(tx: ProjectTx): string | null {
  return tx.actor.kind === "user" ? tx.actor.userId : null;
}

export function createStory(tx: ProjectTx, input: StoryInput): StoryRow {
  const name = input.name.trim();
  if (name.length === 0) throw new HttpError(400, "name_required");
  const storyType = input.story_type ?? "feature";
  const currentState = input.current_state ?? "unscheduled";
  const project = readProject(tx);
  if (input.estimate !== undefined && input.estimate !== null) {
    let scale: number[];
    try {
      scale = parsePointScale(project.point_scale);
    } catch {
      throw new HttpError(400, "points_off_scale");
    }
    if (!isAllowedEstimate(input.estimate, scale)) throw new HttpError(400, "points_off_scale");
  }
  if (input.deadline !== undefined && input.deadline !== null && storyType !== "release") {
    throw new HttpError(400, "deadline_release_only");
  }
  const list = listForState(currentState);
  const now = Date.now();
  const nextNumber = tx.tx
    .select({ n: sql<number>`coalesce(max(${stories.number}), 0) + 1` })
    .from(stories)
    .where(eq(stories.projectId, tx.projectId))
    .get();
  const id = newId();
  tx.tx
    .insert(stories)
    .values({
      id,
      projectId: tx.projectId,
      number: nextNumber?.n ?? 1,
      name,
      description: input.description ?? null,
      storyType,
      currentState,
      estimate: input.estimate ?? null,
      acceptedAt: currentState === "accepted" ? now : null,
      deadline: input.deadline ?? null,
      storyPriority: input.story_priority ?? "none",
      list,
      position:
        input.before_id === undefined && input.after_id === undefined
          ? appendToList(tx, list)
          : placeInList(tx, id, list, { before_id: input.before_id ?? null, after_id: input.after_id ?? null }),
      requestedById: requesterId(tx),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  recordActivity(tx, {
    kind: "story_create_activity",
    message: "added this story",
    highlight: "added",
    changes: [{ kind: "story", id, number: nextNumber?.n ?? 1, change_type: "create", new_values: { name } }],
    primaryResources: [{ kind: "story", id }],
  });
  const requester = requesterId(tx);
  if (requester) ensureFollowing(tx, id, requester);
  return readOne(tx, id);
}

/** Highlight/message pair for the state a mutation lands on; falls back to a generic edit. */
function transitionCopy(to: StoryState): { highlight: string; message: string } {
  switch (to) {
    case "started":
      return { highlight: "started", message: "started this story" };
    case "finished":
      return { highlight: "finished", message: "finished this story" };
    case "delivered":
      return { highlight: "delivered", message: "delivered this story" };
    case "accepted":
      return { highlight: "accepted", message: "accepted this story" };
    case "rejected":
      return { highlight: "rejected", message: "rejected this story" };
    case "unstarted":
      return { highlight: "edited", message: "restarted this story" };
    case "unscheduled":
      return { highlight: "edited", message: "unscheduled this story" };
    case "planned":
      return { highlight: "edited", message: "planned this story" };
  }
}

/**
 * The panel a story is dropped into is part of its state (core-model §1.2 rule 2), so a `group`
 * sent on its own still implies one. An explicit `current_state` in the same patch wins.
 */
function stateForGroup(group: StoryPatch["group"], from: StoryState): StoryState | undefined {
  if (group === undefined) return undefined;
  if (group === "unscheduled") return "unscheduled";
  if (group === "current") return "planned";
  return from === "unscheduled" ? "unstarted" : from;
}

export function updateStory(tx: ProjectTx, storyId: string, patch: StoryPatch): StoryRow {
  const current = loadInProject(tx, stories, storyId);
  // Resolved first: a group the planning mode forbids answers 409 ahead of any 400 and before
  // anything (including a renumber) is written.
  const groupList = listForGroup(tx, patch.group);
  const moveRequested = patch.group !== undefined || patch.before_id !== undefined || patch.after_id !== undefined;
  const set: Record<string, unknown> = {};
  const original: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  let message = "edited this story";
  let highlight = "edited";

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) throw new HttpError(400, "name_required");
    if (name !== current.name) {
      set.name = name;
      original.name = current.name;
      next.name = name;
    }
  }
  if (patch.description !== undefined && patch.description !== current.description) {
    set.description = patch.description;
    original.description = current.description;
    next.description = patch.description;
  }
  if (patch.story_priority !== undefined && patch.story_priority !== current.storyPriority) {
    set.storyPriority = patch.story_priority;
    original.story_priority = current.storyPriority;
    next.story_priority = patch.story_priority;
  }
  const storyType = patch.story_type ?? current.storyType;
  if (patch.story_type !== undefined && patch.story_type !== current.storyType) {
    set.storyType = patch.story_type;
    original.story_type = current.storyType;
    next.story_type = patch.story_type;
  }

  // Validate against the *effective* type (patch.story_type, if given), not the pre-patch one —
  // a same-request `{ story_type: "release", deadline }` must not be rejected for the old type.
  if (patch.deadline !== undefined) {
    if (patch.deadline !== current.deadline) {
      if (patch.deadline !== null && storyType !== "release") throw new HttpError(400, "deadline_release_only");
      set.deadline = patch.deadline;
      original.deadline = current.deadline;
      next.deadline = patch.deadline;
    }
  } else if (storyType !== "release" && current.deadline !== null) {
    // Moving a release to another type: Tracker only shows the deadline field on releases, so
    // the trigger (stories_deadline_release_only_update) would otherwise reject the type change.
    set.deadline = null;
    original.deadline = current.deadline;
    next.deadline = null;
  }

  const targetEstimate = patch.estimate !== undefined ? patch.estimate : current.estimate;
  if (patch.estimate !== undefined && patch.estimate !== current.estimate) {
    const project = readProject(tx);
    let scale: number[];
    try {
      scale = parsePointScale(project.point_scale);
    } catch {
      throw new HttpError(400, "points_off_scale");
    }
    if (!isAllowedEstimate(patch.estimate, scale)) throw new HttpError(400, "points_off_scale");
    set.estimate = patch.estimate;
    original.estimate = current.estimate;
    next.estimate = patch.estimate;
  }

  const targetState = patch.current_state ?? stateForGroup(patch.group, current.currentState);
  if (targetState !== undefined && targetState !== current.currentState) {
    const project = readProject(tx);
    if (!isValidTransition(storyType, current.currentState, targetState)) {
      throw new HttpError(409, "invalid_transition");
    }
    if (
      estimationGateBlocks({
        storyType,
        estimate: targetEstimate,
        targetState,
        bugsAndChoresAreEstimatable: project.bugs_and_chores_are_estimatable,
      })
    ) {
      throw new HttpError(409, "estimate_required");
    }
    set.currentState = targetState;
    original.current_state = current.currentState;
    next.current_state = targetState;

    const acceptedAt = targetState === "accepted" ? Date.now() : null;
    if (acceptedAt !== current.acceptedAt) {
      set.acceptedAt = acceptedAt;
      original.accepted_at = current.acceptedAt;
      next.accepted_at = acceptedAt;
    }

    ({ message, highlight } = transitionCopy(targetState));

    if (targetState === "started") {
      // core-model §1.2 rule 6: starting a story makes the clicker an owner. Folded into this
      // same story_update_activity rather than addOwner's own, so the PUT still writes exactly one.
      const actor = requesterId(tx);
      if (actor) {
        const before = ownerIds(tx, storyId);
        const after = addOwner(tx, storyId, actor, { recordActivity: false });
        if (after.length !== before.length) {
          original.owner_ids = before;
          next.owner_ids = after;
        }
      }
    }
  }

  // list, current_state and position travel in the one UPDATE below: the
  // stories_icebox_is_unscheduled_update trigger aborts on a half-written move.
  const targetList = groupList ?? listForState(targetState ?? current.currentState);
  if (targetList !== current.list) {
    set.list = targetList;
    original.list = current.list;
    next.list = targetList;
  }
  const fieldsChanged = Object.keys(next).length > 0;
  let moved = false;
  let positionBefore = current.position;
  if (moveRequested) {
    set.position = placeInList(tx, storyId, targetList, {
      before_id: patch.before_id ?? null,
      after_id: patch.after_id ?? null,
      ...(patch.group === undefined ? {} : { group: patch.group }),
    });
    // Read back rather than compare with `current`: placeInList may have renumbered the list,
    // which leaves the loaded row's position stale.
    const stored = tx.tx
      .select({ p: stories.position })
      .from(stories)
      .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
      .get();
    positionBefore = stored?.p ?? current.position;
    moved = set.position !== positionBefore || targetList !== current.list;
  } else if (targetList !== current.list) {
    set.position = appendToList(tx, targetList);
  }

  if (!fieldsChanged && !moved) return readOne(tx, storyId);
  set.updatedAt = Date.now();
  tx.tx.update(stories).set(set as never).where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId))).run();
  // Only on entry into accepted, not every edit of an already-accepted story: set.currentState
  // is written exactly when this update transitions state (see targetState above).
  if (set.currentState === "accepted") resolveBlockersReferencing(tx, storyId);
  if (fieldsChanged) {
    recordActivity(tx, {
      kind: "story_update_activity",
      message,
      highlight,
      changes: [{ kind: "story", id: storyId, number: current.number, change_type: "update", original_values: original, new_values: next }],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  if (moved) {
    recordActivity(tx, {
      kind: "story_move_activity",
      message: "moved this story",
      highlight: "moved",
      changes: [
        {
          kind: "story",
          id: storyId,
          number: current.number,
          change_type: "update",
          original_values: { position: positionBefore },
          new_values: { position: set.position },
        },
      ],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return readOne(tx, storyId);
}

export function deleteStory(tx: ProjectTx, storyId: string): void {
  const current = loadInProject(tx, stories, storyId);
  // Before the DELETE: blockers_unlink_on_story_delete (a BEFORE DELETE trigger) nulls the
  // pointer itself, so after the DELETE this service could no longer find the rows to record
  // their blocker_update_activity.
  resolveBlockersReferencing(tx, storyId);
  tx.tx.delete(stories).where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId))).run();
  recordActivity(tx, {
    kind: "story_delete_activity",
    message: "deleted this story",
    highlight: "deleted",
    changes: [
      {
        kind: "story",
        id: storyId,
        number: current.number,
        change_type: "delete",
        original_values: { name: current.name, current_state: current.currentState },
      },
    ],
    primaryResources: [],
  });
}
