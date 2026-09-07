import type { MiddlewareHandler } from "hono";
import type { Db } from "../db/client";
import { HttpError } from "../http-error";
import { hasAnyUser } from "./setup-token";

/** /api/setup must stay reachable, or the instance could never be set up. Exact match only — a
 * subpath like /api/setup/x is a real route that does not exist and must still 409, not slip
 * through as if it were the setup endpoint. */
const EXEMPT = (path: string) => path === "/api/setup";

/**
 * While the instance has no user, API calls answer 409 setup_required as JSON (never a
 * redirect — the SPA decides to show /setup, design §7 step 2). Latched: once a user exists
 * the check is a no-op, so the common case costs nothing.
 */
export function setupGate(db: Db): MiddlewareHandler {
  let ready = false;
  return async (c, next) => {
    if (!ready) {
      if (hasAnyUser(db)) ready = true;
      else if (!EXEMPT(c.req.path)) throw new HttpError(409, "setup_required");
    }
    return next();
  };
}
