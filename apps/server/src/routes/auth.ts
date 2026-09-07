import { Hono } from "hono";
import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Config } from "../config";
import type { Actor, UserActor } from "../db/tx";
import { users } from "../db/schema";
import { HttpError } from "../http-error";
import type { Logger } from "../log";
import {
  assertPasswordAcceptable,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  verifyPassword,
} from "../auth/password";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../auth/cookies";
import { changePassword, createSession, deleteSession } from "../auth/sessions";
import { clientIp, createRateLimiter, LOGIN_LIMITS, PASSWORD_CHANGE_LIMIT, type RateLimiter } from "../auth/rate-limit";
import { consumeResetToken, previewResetToken } from "../services/reset";

/** Same shape as invites' ACCEPT_LIMIT: 20 tries per IP per 15 minutes, per public token route. */
const RESET_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };

export interface AuthDeps {
  db: Db;
  config: Config;
  log: Logger;
  limiters?: { ip: RateLimiter; email: RateLimiter };
  /** GET|POST /api/auth/reset/:token limiter; tests inject a fake clock. */
  resetLimiter?: RateLimiter;
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/**
 * argon2id hash of a random string nobody holds. An unknown or disabled account is verified
 * against this so the KDF always runs: skipping it would make "no such email" answer measurably
 * faster than "wrong password".
 *
 * Computed at import rather than hardcoded, so it cannot fall behind ARGON2_PARAMS — a cheaper
 * stale constant would reopen the timing channel it exists to close.
 */
export const ABSENT_USER_HASH = await hashPassword(`${crypto.randomUUID()}${crypto.randomUUID()}`);

/** Bounds the KDF input before it reaches argon2; short is left to the uniform 401. */
function assertNotOverLong(plain: string): void {
  if ([...plain].length > MAX_PASSWORD_LENGTH) throw new HttpError(400, "password_too_long");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field}_required`);
  return value;
}

function requireUser(actor: Actor): UserActor {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return actor;
}

export function authRoutes(deps: AuthDeps, actorOf: (c: Context) => Actor) {
  const limiters = deps.limiters ?? {
    ip: createRateLimiter(LOGIN_LIMITS.perIp),
    email: createRateLimiter(LOGIN_LIMITS.perEmail),
  };
  // Not part of AuthDeps: the caller is already authenticated here, so there is no fake-clock
  // test that needs to inject it.
  const passwordChanges = createRateLimiter(PASSWORD_CHANGE_LIMIT);
  const resetAttempts = deps.resetLimiter ?? createRateLimiter(RESET_LIMIT);

  /** The users.email index is COLLATE NOCASE; the lookup must use the same collation. */
  const findByEmail = (email: string) =>
    deps.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        isAdmin: users.isAdmin,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(sql`${users.email} = ${email} collate nocase`)
      .get();

  const loadSelf = (actor: UserActor) => {
    const user = deps.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isAdmin: users.isAdmin,
        passwordHash: users.passwordHash,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(eq(users.id, actor.userId))
      .get();
    if (!user || user.disabledAt !== null) throw new HttpError(401, "unauthenticated");
    return user;
  };

  return new Hono()
    .post("/api/auth/login", async (c) => {
      // Before reading the body: a flooding client must not get the server to buffer and parse
      // its payload once it is already over the limit.
      if (!limiters.ip.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const body = (await c.req.json().catch(() => ({}))) as LoginBody;
      // Trimmed the same way setup/invite registration trims it, so a user who registered via
      // an invite with accidental whitespace around their email can still log in.
      const email = requireString(body.email, "email").trim();
      const password = requireString(body.password, "password");
      assertNotOverLong(password);
      const emailKey = email.toLowerCase();
      // Rate limiting is what keeps a password-spraying client from spending 64 MiB of server
      // memory per guess, so the counter is consulted before the KDF runs.
      if (!limiters.email.check(emailKey)) throw new HttpError(429, "too_many_requests");
      const user = findByEmail(email);
      const usable = user !== undefined && user.disabledAt === null;
      // One uniform answer — and one uniform cost — for wrong password / unknown email /
      // disabled account (design §4).
      const ok = await verifyPassword(usable ? user.passwordHash : ABSENT_USER_HASH, password);
      if (!ok || !usable) throw new HttpError(401, "invalid_credentials");
      limiters.email.reset(emailKey);
      // A caller arriving with an older session must not keep it: one cookie, one session row.
      const presented = readSessionCookie(c);
      if (presented) deleteSession(deps.db, presented);
      const { secret, absoluteExpiresAt } = createSession(deps.db, user.id);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ id: user.id, email: user.email, displayName: user.displayName, isAdmin: user.isAdmin });
    })
    .post("/api/auth/logout", (c) => {
      const secret = readSessionCookie(c);
      if (secret) deleteSession(deps.db, secret);
      // Idempotent: a caller whose session already expired still gets its cookie cleared.
      clearSessionCookie(c, deps.config);
      return c.body(null, 204);
    })
    .get("/api/me", (c) => {
      const user = loadSelf(requireUser(actorOf(c)));
      return c.json({ id: user.id, email: user.email, displayName: user.displayName, isAdmin: user.isAdmin });
    })
    .post("/api/me/password", async (c) => {
      const actor = requireUser(actorOf(c));
      const body = (await c.req.json().catch(() => ({}))) as { currentPassword?: unknown; newPassword?: unknown };
      const currentPassword = requireString(body.currentPassword, "current_password");
      const newPassword = requireString(body.newPassword, "new_password");
      // Both inputs are bounded before either reaches argon2.
      assertNotOverLong(currentPassword);
      assertPasswordAcceptable(newPassword);
      if (!passwordChanges.check(actor.userId)) throw new HttpError(429, "too_many_requests");
      const user = loadSelf(actor);
      if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new HttpError(401, "invalid_credentials");
      passwordChanges.reset(actor.userId);
      // Hash before the transaction: bun:sqlite transactions cannot await.
      const passwordHash = await hashPassword(newPassword);
      const changedAt = Date.now();
      // New hash, no surviving sessions and the generation marker, in one transaction.
      changePassword(deps.db, user.id, passwordHash, changedAt);
      // changedAt + 1: resolveSession refuses a session stamped in the same millisecond as the
      // change, so the caller's own replacement has to sit strictly after it.
      const { secret, absoluteExpiresAt } = createSession(deps.db, user.id, changedAt + 1);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ ok: true });
    })
    .get("/api/auth/reset/:token", (c) => {
      if (!resetAttempts.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      c.header("Cache-Control", "no-store");
      const preview = previewResetToken(deps.db, c.req.param("token"));
      if (!preview) throw new HttpError(404, "not_found");
      return c.json(preview);
    })
    .post("/api/auth/reset/:token", async (c) => {
      if (!resetAttempts.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      c.header("Cache-Control", "no-store");
      const token = c.req.param("token");
      const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
      const password = requireString(body.password, "password");
      assertPasswordAcceptable(password);
      // Pre-KDF check, same shape as invites' accept: a garbage token never burns the KDF.
      // consumeResetToken's own in-transaction recheck stays authoritative for the real race.
      if (!previewResetToken(deps.db, token)) throw new HttpError(404, "not_found");
      const passwordHash = await hashPassword(password);
      // Taken after the KDF, not before: credentials_changed_at must postdate every session a
      // concurrent login could have created while hashPassword was running, or resolveSession's
      // createdAt <= credentialsChangedAt check would let that session survive the reset — the
      // same ordering /api/me/password already uses (changedAt below).
      const now = Date.now();
      const { userId } = consumeResetToken(deps.db, token, passwordHash, now);
      deps.log.info("password reset used", { userId });
      // Deliberately no session: the user proves the new password by logging in, same as any
      // other password change (auth-routes tests assert zero surviving/new sessions here).
      return c.json({ ok: true });
    });
}
