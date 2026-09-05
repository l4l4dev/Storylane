import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { projects } from "../db/schema";
import { markAuthorized, type AuthzVars } from "../authz/middleware";

export function projectRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono<AuthzVars>().get("/api/projects/:id", (c) => {
    const id = c.req.param("id");
    const row = withProject(db, actorOf(c), id, "project:read", (tx) => {
      markAuthorized(c);
      return tx.tx
        .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt })
        .from(projects)
        .where(eq(projects.id, tx.projectId))
        .get();
    });
    return c.json(row);
  });
}
