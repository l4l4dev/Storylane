import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { HttpError } from "../http-error";
import { listActivity } from "../services/activity";

function optionalNonNegativeInt(raw: string | undefined, code: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new HttpError(400, code);
  return value;
}

export function activityRoutes(deps: { db: Db; actorOf: (c: Context) => Actor }) {
  const { db, actorOf } = deps;
  return new Hono().get("/api/projects/:id/activity", (c) =>
    // Query validation runs *inside* the callback, like routes/projects.ts' validateProjectPatch:
    // authorization takes precedence over a malformed query (spec/permissions.md), so an
    // anonymous caller gets 401 and a non-member 404 even when since_version is also invalid.
    c.json(
      withProject(db, actorOf(c), c.req.param("id"), "activity:read", (tx) => {
        const sinceVersion = optionalNonNegativeInt(c.req.query("since_version"), "since_version_invalid");
        const limit = optionalNonNegativeInt(c.req.query("limit"), "limit_invalid");
        const offset = optionalNonNegativeInt(c.req.query("offset"), "offset_invalid");
        return listActivity(tx, {
          ...(sinceVersion === undefined ? {} : { sinceVersion }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        });
      }),
    ),
  );
}
