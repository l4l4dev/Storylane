import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { isValidTransition, listForState, parsePointScale, isAllowedEstimate, estimationGateBlocks } from "@storylane/core";
import { stories, type StoryList, type StoryPriority, type StoryState, type StoryType } from "../db/schema";
import { loadInProject, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity } from "./activity";
import { readProject } from "./projects";

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
  /** Task 9 wires the actual move; this task's updateStory carries and ignores it. */
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

/** Owners/labels/followers land in later tasks; this task's rows always report empty sets. */
function toRow(row: typeof COLUMNS extends infer C ? { [K in keyof C]: unknown } : never): StoryRow {
  return { ...(row as Omit<StoryRow, "owner_ids" | "label_ids" | "follower_ids">), owner_ids: [], label_ids: [], follower_ids: [] };
}

function readOne(tx: ProjectTx, storyId: string): StoryRow {
  const row = tx.tx
    .select(COLUMNS)
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return toRow(row);
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
  return rows.map(toRow);
}

function requesterId(tx: ProjectTx): string | null {
  return tx.actor.kind === "user" ? tx.actor.userId : null;
}

/** MAX(position) + 1024 within the list. Task 9's placeInList replaces this and honours before_id/after_id. */
function tailPosition(tx: ProjectTx, list: StoryList): number {
  const row = tx.tx
    .select({ p: sql<number>`coalesce(max(${stories.position}), 0) + 1024` })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.list, list)))
    .get();
  return row?.p ?? 1024;
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
      position: tailPosition(tx, list),
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

export function updateStory(tx: ProjectTx, storyId: string, patch: StoryPatch): StoryRow {
  const current = loadInProject(tx, stories, storyId);
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

  if (patch.current_state !== undefined && patch.current_state !== current.currentState) {
    const project = readProject(tx);
    if (!isValidTransition(storyType, current.currentState, patch.current_state)) {
      throw new HttpError(409, "invalid_transition");
    }
    if (
      estimationGateBlocks({
        storyType,
        estimate: targetEstimate,
        targetState: patch.current_state,
        bugsAndChoresAreEstimatable: project.bugs_and_chores_are_estimatable,
      })
    ) {
      throw new HttpError(409, "estimate_required");
    }
    set.currentState = patch.current_state;
    original.current_state = current.currentState;
    next.current_state = patch.current_state;

    const acceptedAt = patch.current_state === "accepted" ? Date.now() : null;
    if (acceptedAt !== current.acceptedAt) {
      set.acceptedAt = acceptedAt;
      original.accepted_at = current.acceptedAt;
      next.accepted_at = acceptedAt;
    }

    const targetList = listForState(patch.current_state);
    if (targetList !== current.list) {
      set.list = targetList;
      set.position = tailPosition(tx, targetList);
      original.list = current.list;
      next.list = targetList;
    }

    ({ message, highlight } = transitionCopy(patch.current_state));
  }

  if (Object.keys(set).length === 0) return readOne(tx, storyId);
  set.updatedAt = Date.now();
  tx.tx.update(stories).set(set as never).where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId))).run();
  recordActivity(tx, {
    kind: "story_update_activity",
    message,
    highlight,
    changes: [{ kind: "story", id: storyId, number: current.number, change_type: "update", original_values: original, new_values: next }],
    primaryResources: [{ kind: "story", id: storyId }],
  });
  return readOne(tx, storyId);
}

export function deleteStory(tx: ProjectTx, storyId: string): void {
  const current = loadInProject(tx, stories, storyId);
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
