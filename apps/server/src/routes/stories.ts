import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { HttpError } from "../http-error";
import { STORY_TYPES, type StoryType } from "../db/schema";
import { createStory, deleteStory, listStories, moveStory, readBoard, updateStory } from "../services/stories";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function optionalStoryType(value: unknown): StoryType | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(STORY_TYPES as readonly string[]).includes(value)) {
    throw new HttpError(400, "story_type_invalid");
  }
  return value as StoryType;
}

/** Off-scale values are the service's call (409/400 with the project's scale); shape only here. */
function optionalPoints(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new HttpError(400, "points_invalid");
  return value;
}

function optionalStateId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "state_id_invalid");
  return value;
}

function optionalNullableString(value: unknown, code: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, code);
  return value;
}

type StoryInput = Parameters<typeof createStory>[1];
type StoryPatch = Parameters<typeof updateStory>[2];

/**
 * Shapes and bounds a create body. Called inside the withProject callback so authorization
 * decides first (spec/permissions.md); the point *scale* is the service's call, not the route's.
 */
function validateStoryInput(input: Record<string, unknown>): StoryInput {
  if (typeof input.title !== "string") throw new HttpError(400, "title_required");
  const result: StoryInput = { title: input.title, description: null };
  const description = optionalNullableString(input.description, "description_invalid");
  if (description !== undefined) result.description = description;
  const storyType = optionalStoryType(input.storyType);
  if (storyType !== undefined) result.storyType = storyType;
  const points = optionalPoints(input.points);
  if (points !== undefined) result.points = points;
  const stateId = optionalStateId(input.stateId);
  if (stateId !== undefined) result.stateId = stateId;
  const assigneeId = optionalNullableString(input.assigneeId, "assignee_id_invalid");
  if (assigneeId !== undefined) result.assigneeId = assigneeId;
  return result;
}

const PATCH_KEYS = new Set(["title", "description", "storyType", "points", "assigneeId"]);

/**
 * Same precedence rule as validateStoryInput. An absent key means "leave it alone" — so an
 * unrecognized one must be refused, not ignored: accepting `{ stateId }` here and dropping it
 * would answer 200 to a caller who believes she moved the story.
 */
function validateStoryPatch(input: Record<string, unknown>): StoryPatch {
  if ("stateId" in input) throw new HttpError(400, "state_id_unsupported", "moves go through /move");
  for (const key of Object.keys(input)) {
    if (!PATCH_KEYS.has(key)) throw new HttpError(400, "invalid_body", `unknown field ${key}`);
  }
  const patch: StoryPatch = {};
  if (input.title !== undefined) {
    if (typeof input.title !== "string") throw new HttpError(400, "title_required");
    patch.title = input.title;
  }
  if (input.description !== undefined) {
    patch.description = optionalNullableString(input.description, "description_invalid") as string | null;
  }
  const storyType = optionalStoryType(input.storyType);
  if (storyType !== undefined) patch.storyType = storyType;
  const points = optionalPoints(input.points);
  if (points !== undefined) patch.points = points;
  if (input.assigneeId !== undefined) {
    patch.assigneeId = optionalNullableString(input.assigneeId, "assignee_id_invalid") as string | null;
  }
  return patch;
}

function requireIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new HttpError(400, "ordered_ids_invalid");
  }
  return value as string[];
}

export function storyRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono()
    .get("/api/projects/:id/board", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => readBoard(tx))),
    )
    .get("/api/projects/:id/stories", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => listStories(tx))),
    )
    .post("/api/projects/:id/stories", async (c) => {
      // Parsing happens out here (the callback is sync); every *check* runs inside it, so a
      // caller who may not write gets 401/403/404 before the body is judged (spec/permissions.md).
      const input = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:write", (tx) =>
          createStory(tx, validateStoryInput(input)),
        ),
        201,
      );
    })
    .patch("/api/projects/:id/stories/:storyId", async (c) => {
      const input = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:write", (tx) =>
          updateStory(tx, c.req.param("storyId"), validateStoryPatch(input)),
        ),
      );
    })
    .post("/api/projects/:id/stories/:storyId/move", async (c) => {
      const input = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:write", (tx) => {
          const stateId = optionalStateId(input.stateId);
          // Absent is not the same as null: null means the Icebox, so the move must say which.
          if (stateId === undefined) throw new HttpError(400, "state_id_required");
          const orderedIds = requireIdList(input.orderedIds);
          return moveStory(tx, c.req.param("storyId"), { stateId, orderedIds });
        }),
      );
    })
    .delete("/api/projects/:id/stories/:storyId", (c) => {
      withProject(db, actorOf(c), c.req.param("id"), "story:delete", (tx) => deleteStory(tx, c.req.param("storyId")));
      return c.body(null, 204);
    });
}
