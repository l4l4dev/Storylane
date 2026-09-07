import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { readProject } from "../services/projects";

export function projectRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono().get("/api/projects/:id", (c) =>
    c.json(withProject(db, actorOf(c), c.req.param("id"), "project:read", (tx) => readProject(tx))),
  );
}
