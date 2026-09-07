import { Hono } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword } from "../auth/password";
import { setSessionCookie } from "../auth/cookies";
import { createSession } from "../auth/sessions";
import { clientIp, createRateLimiter, type RateLimiter } from "../auth/rate-limit";
import { assertTokenLength } from "../auth/tokens";
import { hasAnyUser, peekSetupToken } from "../setup/setup-token";
import { completeSetup } from "../services/setup";

const SETUP_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };
const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 80;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field}_required`);
  return value;
}

/** Trimmed only, case preserved — login's lookup is COLLATE NOCASE, so case does not need folding. */
function normalizeEmail(raw: string): string {
  const trimmed = raw.trim();
  const at = trimmed.indexOf("@");
  const validShape = at > 0 && at === trimmed.lastIndexOf("@") && at < trimmed.length - 1;
  if (!validShape || trimmed.length > MAX_EMAIL_LENGTH) throw new HttpError(400, "invalid_body");
  return trimmed;
}

function normalizeDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) throw new HttpError(400, "invalid_body");
  return trimmed;
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
      assertTokenLength(token); // before hashToken — see auth/tokens.ts
      const email = normalizeEmail(requireString(body.email, "email"));
      const displayName = normalizeDisplayName(requireString(body.displayName, "display_name"));
      const password = requireString(body.password, "password");
      // Read-only pre-check against the plain db, outside any transaction and before the KDF:
      // an attacker submitting garbage tokens must not be able to burn the argon2id pool.
      // completeSetup's in-transaction re-check stays authoritative (it also handles the race
      // between a valid token and a concurrent second submission).
      if (!peekSetupToken(deps.db, token, Date.now())) throw new HttpError(403, "setup_token_invalid");
      assertPasswordAcceptable(password);
      // Hash before the transaction: bun:sqlite transactions cannot await.
      const passwordHash = await hashPassword(password);
      const { userId } = completeSetup(deps.db, { token, email, displayName, passwordHash });
      const { secret, absoluteExpiresAt } = createSession(deps.db, userId);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ id: userId, email, displayName, isAdmin: true });
    });
}
