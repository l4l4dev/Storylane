import { Hono } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword } from "../auth/password";
import { setSessionCookie } from "../auth/cookies";
import { createSession } from "../auth/sessions";
import { clientIp, createRateLimiter, type RateLimiter } from "../auth/rate-limit";
import { hasAnyUser } from "../setup/setup-token";
import { completeSetup } from "../services/setup";

const SETUP_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field}_required`);
  return value;
}

export function setupRoutes(deps: { db: Db; config: Config; limiter?: RateLimiter }) {
  const limiter = deps.limiter ?? createRateLimiter(SETUP_LIMIT);
  return new Hono()
    .get("/api/setup", (c) => {
      if (hasAnyUser(deps.db)) throw new HttpError(404, "not_found");
      // The SPA uses this to decide whether to show /setup instead of the login screen.
      return c.json({ setupRequired: true });
    })
    .post("/api/setup", async (c) => {
      if (hasAnyUser(deps.db)) throw new HttpError(404, "not_found");
      if (!limiter.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const token = requireString(body.token, "token");
      const email = requireString(body.email, "email");
      const displayName = requireString(body.displayName, "display_name");
      const password = requireString(body.password, "password");
      assertPasswordAcceptable(password);
      // Hash before the transaction: bun:sqlite transactions cannot await.
      const passwordHash = await hashPassword(password);
      const { userId } = completeSetup(deps.db, { token, email, displayName, passwordHash });
      const { secret, absoluteExpiresAt } = createSession(deps.db, userId);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ id: userId, email, displayName, isAdmin: true });
    });
}
