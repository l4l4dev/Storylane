import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { EventBus } from "../events/bus";
import { HttpError } from "../http-error";
import {
  createProject,
  deleteProject,
  listProjects,
  readProject,
  setArchived,
  updateProject,
  type ProjectPatch,
} from "../services/projects";
import { DESCRIPTION_MAX, NAME_MAX, assertMaxLength } from "./limits";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

/**
 * Shapes and bounds the PATCH body; every check throws HttpError so it can run inside the
 * withProject callback (auth precedence over body validation — spec/permissions.md).
 */
function validateProjectPatch(input: Record<string, unknown>): ProjectPatch {
  const patch: ProjectPatch = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) throw new HttpError(400, "name_required");
    assertMaxLength(input.name, NAME_MAX, "name_too_long");
    patch.name = input.name;
  }
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== "string") {
      throw new HttpError(400, "description_invalid");
    }
    if (typeof input.description === "string") assertMaxLength(input.description, DESCRIPTION_MAX, "description_too_long");
    patch.description = input.description as string | null;
  }
  // PROVISIONAL (Task 7 owns the settings routes): the scale is now the stored
  // comma-separated string; the service validates its shape.
  if (input.pointScale !== undefined) {
    if (typeof input.pointScale !== "string" || input.pointScale.trim().length === 0) {
      throw new HttpError(400, "point_scale_invalid");
    }
    patch.pointScale = input.pointScale;
  }
  return patch;
}

export function projectRoutes(deps: { db: Db; bus: EventBus; actorOf: (c: Context) => Actor }) {
  const { db, actorOf } = deps;
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
      if (typeof input.name !== "string") throw new HttpError(400, "name_required");
      assertMaxLength(input.name, NAME_MAX, "name_too_long");
      return c.json(createProject(db, actor, { name: input.name }), 201);
    })
    .get("/api/projects/:id", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:read", (tx) => readProject(tx))),
    )
    .patch("/api/projects/:id", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "project:update", (tx) =>
          updateProject(tx, validateProjectPatch(input)),
        ),
      );
    })
    .delete("/api/projects/:id", (c) => {
      withProjectChange(deps, actorOf(c), c.req.param("id"), "project:delete", (tx) => deleteProject(tx));
      return c.body(null, 204);
    })
    .post("/api/projects/:id/archive", (c) =>
      c.json(withProjectChange(deps, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, true))),
    )
    .post("/api/projects/:id/unarchive", (c) =>
      c.json(withProjectChange(deps, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, false))),
    );
}
