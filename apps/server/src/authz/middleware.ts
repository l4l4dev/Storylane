import type { MiddlewareHandler } from "hono";
import { runAuthzScope } from "./context";

/**
 * Fail closed: a successful response under /api/projects/:id/** must have authorized
 * *that* project id. Authorizing a different project (or none) answers 500.
 */
export function failClosed(): MiddlewareHandler {
  return async (c, next) => {
    const { authorized } = await runAuthzScope(() => next());
    const requested = c.req.param("id");
    // Only a success can leak data; the 401/403/404/409 authorizeIn raises never gets here authorized.
    if (c.res.status < 400 && (requested === undefined || !authorized.has(requested))) {
      c.res = c.json({ error: "authorization_missing" }, 500);
    }
  };
}
