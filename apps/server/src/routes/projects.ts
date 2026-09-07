import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { readProject } from "../services/projects";

export function projectRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono().get("/api/projects/:id", (c) => {
    const id = c.req.param("id");
    const row = withProject(db, actorOf(c), id, "project:read", (tx) => readProject(tx));
    return c.json(row);
  });
}
