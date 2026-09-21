import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor, type ProjectTx } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { EventBus } from "../events/bus";
import type { Logger } from "../log";
import { HttpError } from "../http-error";
import { STORY_PRIORITIES, STORY_STATES, STORY_TYPES, type StoryPriority, type StoryState, type StoryType } from "../db/schema";
import { createStory, deleteStory, listStories, readStory, updateStory, type StoryFilter, type StoryInput, type StoryPatch } from "../services/stories";
import { addFollower, addOwner, removeFollower, removeOwner } from "../services/story-people";
import type { AttachmentStore } from "../attachments/store";
import { storyAttachmentPaths } from "../services/comments";
import { removeQuietly } from "./story-parts";
import { DESCRIPTION_MAX, NAME_MAX, assertMaxLength } from "./limits";

/** Authorization already guarantees a user actor by the time a callback runs inside it. */
function actorUserId(tx: ProjectTx): string {
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return tx.actor.userId;
}

// A malformed body carries nothing about the project, so this 400 may answer before 404/403.
const body = async (c: Context): Promise<Record<string, unknown>> => {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_body");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "invalid_body");
  return parsed as Record<string, unknown>;
};

function optionalStoryType(value: unknown): StoryType | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(STORY_TYPES as readonly string[]).includes(value)) {
    throw new HttpError(400, "story_type_invalid");
  }
  return value as StoryType;
}

function optionalStoryState(value: unknown): StoryState | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(STORY_STATES as readonly string[]).includes(value)) {
    throw new HttpError(400, "current_state_invalid");
  }
  return value as StoryState;
}

function optionalStoryPriority(value: unknown): StoryPriority | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(STORY_PRIORITIES as readonly string[]).includes(value)) {
    throw new HttpError(400, "story_priority_invalid");
  }
  return value as StoryPriority;
}

function optionalEstimate(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number") throw new HttpError(400, "estimate_invalid");
  return value;
}

function optionalDeadline(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number") throw new HttpError(400, "deadline_invalid");
  return value;
}

function optionalNullableString(value: unknown, code: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, code);
  return value;
}

const GROUPS = new Set(["unscheduled", "scheduled", "current"]);

function optionalGroup(value: unknown): StoryPatch["group"] {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !GROUPS.has(value)) throw new HttpError(400, "group_invalid");
  return value as StoryPatch["group"];
}

const CREATE_KEYS = new Set([
  "name", "description", "story_type", "current_state", "estimate", "deadline", "story_priority", "before_id", "after_id",
]);
const PATCH_KEYS = new Set([...CREATE_KEYS, "group"]);

/** An unrecognized key is a caller mistake, not a field to drop. */
function rejectUnknownKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new HttpError(400, "invalid_body", `unknown field ${key}`);
  }
}

/** Shapes and bounds a create body; the point *scale* is the service's call, not the route's. */
function validateStoryInput(input: Record<string, unknown>): StoryInput {
  rejectUnknownKeys(input, CREATE_KEYS);
  if (typeof input.name !== "string") throw new HttpError(400, "name_required");
  assertMaxLength(input.name, NAME_MAX, "name_too_long");
  const result: StoryInput = { name: input.name };
  const description = optionalNullableString(input.description, "description_invalid");
  if (description !== undefined) {
    if (description !== null) assertMaxLength(description, DESCRIPTION_MAX, "description_too_long");
    result.description = description;
  }
  const storyType = optionalStoryType(input.story_type);
  if (storyType !== undefined) result.story_type = storyType;
  const currentState = optionalStoryState(input.current_state);
  if (currentState !== undefined) result.current_state = currentState;
  const estimate = optionalEstimate(input.estimate);
  if (estimate !== undefined) result.estimate = estimate;
  const deadline = optionalDeadline(input.deadline);
  if (deadline !== undefined) result.deadline = deadline;
  const storyPriority = optionalStoryPriority(input.story_priority);
  if (storyPriority !== undefined) result.story_priority = storyPriority;
  const beforeId = optionalNullableString(input.before_id, "before_id_invalid");
  if (beforeId !== undefined) result.before_id = beforeId;
  const afterId = optionalNullableString(input.after_id, "after_id_invalid");
  if (afterId !== undefined) result.after_id = afterId;
  return result;
}

/** Same precedence rule as validateStoryInput: an unrecognized key must be refused, not ignored. */
function validateStoryPatch(input: Record<string, unknown>): StoryPatch {
  rejectUnknownKeys(input, PATCH_KEYS);
  const patch: StoryPatch = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string") throw new HttpError(400, "name_required");
    assertMaxLength(input.name, NAME_MAX, "name_too_long");
    patch.name = input.name;
  }
  const description = optionalNullableString(input.description, "description_invalid");
  if (description !== undefined) {
    if (description !== null) assertMaxLength(description, DESCRIPTION_MAX, "description_too_long");
    patch.description = description;
  }
  const storyType = optionalStoryType(input.story_type);
  if (storyType !== undefined) patch.story_type = storyType;
  const currentState = optionalStoryState(input.current_state);
  if (currentState !== undefined) patch.current_state = currentState;
  const estimate = optionalEstimate(input.estimate);
  if (estimate !== undefined) patch.estimate = estimate;
  const deadline = optionalDeadline(input.deadline);
  if (deadline !== undefined) patch.deadline = deadline;
  const storyPriority = optionalStoryPriority(input.story_priority);
  if (storyPriority !== undefined) patch.story_priority = storyPriority;
  const beforeId = optionalNullableString(input.before_id, "before_id_invalid");
  if (beforeId !== undefined) patch.before_id = beforeId;
  const afterId = optionalNullableString(input.after_id, "after_id_invalid");
  if (afterId !== undefined) patch.after_id = afterId;
  const group = optionalGroup(input.group);
  if (group !== undefined) patch.group = group;
  return patch;
}

function optionalQueryInteger(value: string | undefined, min: number, max: number, code: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new HttpError(400, code);
  const n = Number(value);
  if (n < min || n > max) throw new HttpError(400, code);
  return n;
}

/** Tracker's list params are comma-separated; an unknown member must refuse, not silently drop. */
function optionalQueryEnumList<T extends string>(
  value: string | undefined,
  allowed: readonly string[],
  code: string,
): T[] | undefined {
  if (value === undefined) return undefined;
  const parts = value.split(",");
  for (const part of parts) {
    if (!allowed.includes(part)) throw new HttpError(400, code);
  }
  return parts as T[];
}

function validateStoryFilter(query: Record<string, string>): StoryFilter {
  const filter: StoryFilter = {};
  const limit = optionalQueryInteger(query.limit, 1, 500, "limit_invalid");
  if (limit !== undefined) filter.limit = limit;
  const offset = optionalQueryInteger(query.offset, 0, Number.MAX_SAFE_INTEGER, "offset_invalid");
  if (offset !== undefined) filter.offset = offset;
  const withState = optionalQueryEnumList<StoryState>(query.with_state, STORY_STATES, "with_state_invalid");
  if (withState !== undefined) filter.withState = withState;
  const withStoryType = optionalQueryEnumList<StoryType>(query.with_story_type, STORY_TYPES, "with_story_type_invalid");
  if (withStoryType !== undefined) filter.withStoryType = withStoryType;
  if (query.with_label !== undefined) filter.withLabel = query.with_label;
  return filter;
}

export function storyRoutes(deps: {
  db: Db;
  bus: EventBus;
  log: Logger;
  actorOf: (c: Context) => Actor;
  store: AttachmentStore;
}) {
  const { db, actorOf } = deps;
  return new Hono()
    .get("/api/projects/:id/stories", (c) =>
      c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) =>
          listStories(tx, validateStoryFilter(c.req.query())),
        ),
      ),
    )
    .post("/api/projects/:id/stories", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "story:write", (tx) =>
          createStory(tx, validateStoryInput(input)),
        ),
        201,
      );
    })
    .get("/api/projects/:id/stories/:storyId", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => readStory(tx, c.req.param("storyId")))),
    )
    .put("/api/projects/:id/stories/:storyId", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "story:write", (tx) =>
          updateStory(tx, c.req.param("storyId"), validateStoryPatch(input)),
        ),
      );
    })
    .delete("/api/projects/:id/stories/:storyId", (c) => {
      const storagePaths = withProjectChange(deps, actorOf(c), c.req.param("id"), "story:delete", (tx) => {
        const paths = storyAttachmentPaths(tx, c.req.param("storyId"));
        deleteStory(tx, c.req.param("storyId"));
        return paths;
      });
      removeQuietly(deps.log, deps.store, storagePaths);
      return c.body(null, 204);
    })
    .post("/api/projects/:id/stories/:storyId/owners/:userId", (c) =>
      c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "story:write", (tx) => {
          addOwner(tx, c.req.param("storyId"), c.req.param("userId"));
          return readStory(tx, c.req.param("storyId"));
        }),
      ),
    )
    .delete("/api/projects/:id/stories/:storyId/owners/:userId", (c) =>
      c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "story:write", (tx) => {
          removeOwner(tx, c.req.param("storyId"), c.req.param("userId"));
          return readStory(tx, c.req.param("storyId"));
        }),
      ),
    )
    .post("/api/projects/:id/stories/:storyId/follow", (c) =>
      c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "follower:write", (tx) => {
          addFollower(tx, c.req.param("storyId"), actorUserId(tx));
          return readStory(tx, c.req.param("storyId"));
        }),
      ),
    )
    .delete("/api/projects/:id/stories/:storyId/follow", (c) =>
      c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "follower:write", (tx) => {
          removeFollower(tx, c.req.param("storyId"), actorUserId(tx));
          return readStory(tx, c.req.param("storyId"));
        }),
      ),
    )
    .post("/api/projects/:id/stories/:storyId/followers/:userId", (c) =>
      c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "story:write", (tx) => {
          addFollower(tx, c.req.param("storyId"), c.req.param("userId"));
          return readStory(tx, c.req.param("storyId"));
        }),
      ),
    )
    .delete("/api/projects/:id/stories/:storyId/followers/:userId", (c) =>
      c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "story:write", (tx) => {
          removeFollower(tx, c.req.param("storyId"), c.req.param("userId"));
          return readStory(tx, c.req.param("storyId"));
        }),
      ),
    );
}
