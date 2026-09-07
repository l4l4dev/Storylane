import { Hono } from "hono";
import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Config } from "../config";
import type { Actor, UserActor } from "../db/tx";
import { users } from "../db/schema";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword, verifyPassword } from "../auth/password";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../auth/cookies";
import { createSession, deleteSession, revokeUserSessions } from "../auth/sessions";
import { clientIp, createRateLimiter, LOGIN_LIMITS, type RateLimiter } from "../auth/rate-limit";

export interface AuthDeps {
  db: Db;
  config: Config;
  limiters?: { ip: RateLimiter; email: RateLimiter };
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/**
 * argon2id hash of a random string nobody holds, at ARGON2_PARAMS cost. An unknown or disabled
 * account is verified against this so the KDF always runs: skipping it would make "no such
 * email" answer measurably faster than "wrong password".
 */
const ABSENT_USER_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$M5KkRPlcWgb3ZRs5AfJGqB0zNQQy0yNJi30i79OxOe8$IDNQt5QSPWogkWIix7EESPoRNlWkE2hUTlp0dJD2xT8";

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
      const body = (await c.req.json().catch(() => ({}))) as LoginBody;
      const email = requireString(body.email, "email");
      const password = requireString(body.password, "password");
      const emailKey = email.toLowerCase();
      const ip = clientIp(c, deps.config);
      // Both counters are consulted before the KDF runs: rate limiting is what keeps a
      // password-spraying client from spending 64 MiB of server memory per guess.
      if (!limiters.ip.check(ip) || !limiters.email.check(emailKey)) {
        throw new HttpError(429, "too_many_requests");
      }
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
      const user = loadSelf(actor);
      if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new HttpError(401, "invalid_credentials");
      assertPasswordAcceptable(newPassword);
      // Hash before any transaction: bun:sqlite transactions cannot await.
      const passwordHash = await hashPassword(newPassword);
      deps.db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
      // Stamps credentials_changed_at, so a session whose INSERT raced the DELETE is refused too.
      revokeUserSessions(deps.db, user.id);
      const { secret, absoluteExpiresAt } = createSession(deps.db, user.id);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ ok: true });
    });
}
