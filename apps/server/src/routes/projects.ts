import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { HttpError } from "../http-error";
import {
  createProject,
  deleteProject,
  listProjects,
  readProject,
  setArchived,
  updateProject,
  type ProjectPatch,
  type ProjectTemplate,
} from "../services/projects";
import { createState, deleteState, listStates, reorderStates, updateState, type StatePatch } from "../services/states";
import { POINT_SCALES, STATE_CATEGORIES, type PointScale, type StateCategory } from "../db/schema";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function requireCategory(value: unknown): StateCategory {
  if (typeof value !== "string" || !(STATE_CATEGORIES as readonly string[]).includes(value)) {
    throw new HttpError(400, "category_invalid");
  }
  return value as StateCategory;
}

function requireIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new HttpError(400, "ordered_ids_invalid");
  return value as string[];
}

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

/**
 * Shapes and bounds the PATCH body; every check throws HttpError so it can run inside the
 * withProject callback (auth precedence over body validation — spec/permissions.md).
 */
function validateProjectPatch(input: Record<string, unknown>): ProjectPatch {
  const patch: ProjectPatch = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) throw new HttpError(400, "name_required");
    if (input.name.length > NAME_MAX) throw new HttpError(400, "name_too_long");
    patch.name = input.name;
  }
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== "string") {
      throw new HttpError(400, "description_invalid");
    }
    if (typeof input.description === "string" && input.description.length > DESCRIPTION_MAX) {
      throw new HttpError(400, "description_too_long");
    }
    patch.description = input.description as string | null;
  }
  if (input.pointScale !== undefined) {
    if (typeof input.pointScale !== "string" || !(POINT_SCALES as readonly string[]).includes(input.pointScale)) {
      throw new HttpError(400, "point_scale_invalid");
    }
    patch.pointScale = input.pointScale as PointScale;
  }
  if (input.customPoints !== undefined) {
    if (
      input.customPoints !== null &&
      (!Array.isArray(input.customPoints) || input.customPoints.some((n) => typeof n !== "number"))
    ) {
      throw new HttpError(400, "custom_points_invalid");
    }
    patch.customPoints = input.customPoints as number[] | null;
  }
  return patch;
}

/** Same precedence rule as validateProjectPatch: called inside the withProject callback. */
function validateStatePatch(input: Record<string, unknown>): StatePatch {
  const patch: StatePatch = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.length === 0) throw new HttpError(400, "name_required");
    patch.name = input.name;
  }
  if (input.actionLabel !== undefined) {
    if (input.actionLabel !== null && typeof input.actionLabel !== "string") {
      throw new HttpError(400, "action_label_invalid");
    }
    patch.actionLabel = input.actionLabel as string | null;
  }
  // A category is only ever accepted so updateState's own immutability check (409, not 400)
  // can fire on a genuine mismatch — the route does not decide whether a change is allowed.
  if (input.category !== undefined) patch.category = requireCategory(input.category);
  return patch;
}

export function projectRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono()
    .get("/api/projects", (c) => c.json(listProjects(db, actorOf(c))))
    .post("/api/projects", async (c) => {
      // Auth precedence over body validation (spec/permissions.md): an anonymous caller must
      // get 401 even when the body is also invalid, not a 400 that leaks nothing about auth.
      // createProject re-checks this itself (it has direct callers besides this route, e.g.
      // tests and other services), so this is a deliberate short-circuit before the async body
      // parse, not a sign the service check is redundant.
      const actor = actorOf(c);
      if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
      const input = await body(c);
      const template = input.template === "minimal" ? ("minimal" as ProjectTemplate) : ("classic" as ProjectTemplate);
      if (typeof input.name !== "string") throw new HttpError(400, "name_required");
      return c.json(createProject(db, actor, { name: input.name, template }), 201);
    })
    .get("/api/projects/:id", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:read", (tx) => readProject(tx))),
    )
    .patch("/api/projects/:id", async (c) => {
      const input = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "project:update", (tx) =>
          updateProject(tx, validateProjectPatch(input)),
        ),
      );
    })
    .delete("/api/projects/:id", (c) => {
      withProject(db, actorOf(c), c.req.param("id"), "project:delete", (tx) => deleteProject(tx));
      return c.body(null, 204);
    })
    .post("/api/projects/:id/archive", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, true))),
    )
    .post("/api/projects/:id/unarchive", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, false))),
    )
    .get("/api/projects/:id/states", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "state:read", (tx) => listStates(tx))),
    )
    .post("/api/projects/:id/states", async (c) => {
      const input = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) => {
          if (typeof input.name !== "string" || input.name.length === 0) throw new HttpError(400, "name_required");
          const category = requireCategory(input.category);
          if (input.actionLabel !== undefined && input.actionLabel !== null && typeof input.actionLabel !== "string") {
            throw new HttpError(400, "action_label_invalid");
          }
          const actionLabel = (input.actionLabel as string | null | undefined) ?? null;
          return createState(tx, { name: input.name, category, actionLabel });
        }),
        201,
      );
    })
    .post("/api/projects/:id/states/reorder", async (c) => {
      const input = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) =>
          reorderStates(tx, requireIdList(input.orderedIds)),
        ),
      );
    })
    .patch("/api/projects/:id/states/:stateId", async (c) => {
      const input = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) =>
          updateState(tx, c.req.param("stateId"), validateStatePatch(input)),
        ),
      );
    })
    .delete("/api/projects/:id/states/:stateId", (c) => {
      withProject(db, actorOf(c), c.req.param("id"), "state:delete", (tx) => deleteState(tx, c.req.param("stateId")));
      return c.body(null, 204);
    });
}
