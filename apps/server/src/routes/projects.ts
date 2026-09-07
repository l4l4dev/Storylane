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
  type ProjectTemplate,
} from "../services/projects";
import { createState, deleteState, listStates, reorderStates, updateState } from "../services/states";
import { STATE_CATEGORIES, type StateCategory } from "../db/schema";

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

export function projectRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono()
    .get("/api/projects", (c) => c.json(listProjects(db, actorOf(c))))
    .post("/api/projects", async (c) => {
      // Auth precedence over body validation (spec/permissions.md): an anonymous caller must
      // get 401 even when the body is also invalid, not a 400 that leaks nothing about auth.
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
      const patch = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "project:update", (tx) => updateProject(tx, patch as never)),
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
      if (typeof input.name !== "string" || input.name.length === 0) throw new HttpError(400, "name_required");
      const category = requireCategory(input.category);
      const actionLabel = typeof input.actionLabel === "string" ? input.actionLabel : null;
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) =>
          createState(tx, { name: input.name as string, category, actionLabel }),
        ),
        201,
      );
    })
    .post("/api/projects/:id/states/reorder", async (c) => {
      const orderedIds = requireIdList((await body(c)).orderedIds);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) => reorderStates(tx, orderedIds)),
      );
    })
    .patch("/api/projects/:id/states/:stateId", async (c) => {
      const patch = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) =>
          updateState(tx, c.req.param("stateId"), patch as never),
        ),
      );
    })
    .delete("/api/projects/:id/states/:stateId", (c) => {
      withProject(db, actorOf(c), c.req.param("id"), "state:delete", (tx) => deleteState(tx, c.req.param("stateId")));
      return c.body(null, 204);
    });
}
