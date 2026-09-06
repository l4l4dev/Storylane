import type { MiddlewareHandler } from "hono";
import { runAuthzScope } from "./context";

/** Fail closed: a project-scoped handler that answered successfully without authorizing answers 500. */
export function failClosed(): MiddlewareHandler {
  return async (c, next) => {
    const { authorized } = await runAuthzScope(() => next());
    // Only a success can leak data; the 401/403/404/409 authorizeIn raises never reaches here authorized.
    if (c.res.status < 400 && authorized === 0) {
      c.res = c.json({ error: "authorization_missing" }, 500);
    }
  };
}
