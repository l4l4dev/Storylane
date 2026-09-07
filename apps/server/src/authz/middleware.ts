import type { MiddlewareHandler } from "hono";
import { runAuthzScope } from "./context";

/**
 * The project id is read by position, not by `c.req.param("id")`: after next() the params
 * come from the *matched route's* pattern, so a route declaring /api/projects/:pid/link/:id
 * would have the guard check the wrong segment. Segment 3 of /api/projects/<id>/… is the
 * one the guard's own path matched.
 */
function requestedProjectId(path: string): string | undefined {
  const raw = path.split("/")[3];
  if (raw === undefined || raw === "") return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape cannot name a project; fail closed.
    return undefined;
  }
}

/**
 * Fail closed: a successful response under /api/projects/:id/** must have authorized
 * *that* project id. Authorizing a different project (or none) answers 500.
 */
export function failClosed(): MiddlewareHandler {
  return async (c, next) => {
    const { authorized } = await runAuthzScope(() => next());
    const requested = requestedProjectId(c.req.path);
    // Only a success can leak data; the 401/403/404/409 authorizeIn raises never gets here authorized.
    if (c.res.status < 400 && (requested === undefined || !authorized.has(requested))) {
      c.res = c.json({ error: "authorization_missing" }, 500);
    }
  };
}
