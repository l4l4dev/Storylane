import type { Context, MiddlewareHandler } from "hono";

export type AuthzVars = { Variables: { authzDone: boolean } };

export function markAuthorized(c: Context<AuthzVars>): void {
  c.set("authzDone", true);
}

/** Fail closed: a project-scoped handler that answered successfully without authorizing answers 500. */
export function failClosed(): MiddlewareHandler<AuthzVars> {
  return async (c, next) => {
    c.set("authzDone", false);
    await next();
    // Only a success can leak data; the 401/403/404/409 that authorizeIn raises never set the flag.
    if (c.res.status < 400 && !c.get("authzDone")) {
      c.res = c.json({ error: "authorization_missing" }, 500);
    }
  };
}
