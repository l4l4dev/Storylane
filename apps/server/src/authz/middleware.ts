import type { MiddlewareHandler } from "hono";
import { authzScope } from "./context";

/** Fail closed: a project-scoped handler that answered successfully without authorizing answers 500. */
export function failClosed(): MiddlewareHandler {
  return async (c, next) => {
    // Two matchers cover the project routes; only the outermost owns the counter.
    if (authzScope.getStore()) return next();
    const store = { authorized: 0 };
    await authzScope.run(store, () => next());
    // Only a success can leak data; the 401/403/404/409 authorizeIn raises never reaches here authorized.
    if (c.res.status < 400 && store.authorized === 0) {
      c.res = c.json({ error: "authorization_missing" }, 500);
    }
  };
}
