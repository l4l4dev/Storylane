import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { Actor } from "../db/tx";
import type { Logger } from "../log";
import { requireAdmin } from "../authz/admin";
import { mintResetToken } from "../services/reset";
import { createRateLimiter, type RateLimiter } from "../auth/rate-limit";
import { HttpError } from "../http-error";

/** An admin is already an authenticated, accountable actor — keyed by admin id, not IP. */
const ADMIN_MINT_LIMIT = { limit: 30, windowMs: 15 * 60 * 1000 };

export function adminRoutes(deps: {
  db: Db;
  config: Config;
  log: Logger;
  actorOf: (c: Context) => Actor;
  /** POST /api/admin/users/:userId/reset-link limiter; tests inject a fake clock. */
  limiter?: RateLimiter;
}) {
  const mintAttempts = deps.limiter ?? createRateLimiter(ADMIN_MINT_LIMIT);
  return new Hono().post("/api/admin/users/:userId/reset-link", (c) => {
    const admin = requireAdmin(deps.actorOf(c));
    if (!mintAttempts.check(admin.userId)) throw new HttpError(429, "too_many_requests");
    c.header("Cache-Control", "no-store");
    const { token, expiresAt } = mintResetToken(deps.db, admin, c.req.param("userId"));
    const path = `/reset/${token}`;
    // Never the token itself — see log.ts's redaction of this same path for the public routes.
    deps.log.info("password reset link minted", { userId: c.req.param("userId"), adminId: admin.userId });
    // The absolute URL is only knowable when STORYLANE_BASE_URL is set; the admin UI can
    // always build one from the browser's own origin.
    return c.json({ token, expiresAt, path, url: deps.config.baseUrl ? new URL(path, deps.config.baseUrl).toString() : null });
  });
}
