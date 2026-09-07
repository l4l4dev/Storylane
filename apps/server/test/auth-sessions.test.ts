import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, disableUser, seedUser } from "./harness";
import { hashToken } from "../src/auth/tokens";
import {
  changePassword,
  createSession,
  createSessionIfCurrent,
  deleteSession,
  purgeExpiredSessions,
  resolveSession,
  revokeUserSessions,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "../src/auth/sessions";
import { sessions, users } from "../src/db/schema";
import type { Db } from "../src/db/client";

let db: Db;
let userId: string;

beforeEach(() => {
  db = makeTestDb();
  const actor = seedUser(db, "user@example.test");
  userId = (actor as { userId: string }).userId;
});

describe("createSession", () => {
  it("stores the hash, never the secret", () => {
    const { secret } = createSession(db, userId);
    const rows = db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(hashToken(secret));
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("sets both expiries from the given clock", () => {
    const now = 1_700_000_000_000;
    createSession(db, userId, now);
    const row = db.select().from(sessions).all()[0]!;
    expect(row.createdAt).toBe(now);
    expect(row.absoluteExpiresAt).toBe(now + SESSION_ABSOLUTE_MS);
    expect(row.idleExpiresAt).toBe(now + SESSION_IDLE_MS);
  });

  it("issues a different id every time (new id on login)", () => {
    const a = createSession(db, userId).secret;
    const b = createSession(db, userId).secret;
    expect(a).not.toBe(b);
    expect(db.select().from(sessions).all()).toHaveLength(2);
  });
});

describe("resolveSession", () => {
  it("returns the user and admin flag", () => {
    const admin = seedUser(db, "admin@example.test", true);
    const { secret } = createSession(db, (admin as { userId: string }).userId);
    expect(resolveSession(db, secret)).toEqual({ userId: (admin as { userId: string }).userId, isAdmin: true });
  });

  it("returns null for an unknown, idle-expired or absolutely-expired secret", () => {
    const now = 1_700_000_000_000;
    const { secret } = createSession(db, userId, now);
    expect(resolveSession(db, "nonsense", now)).toBeNull();
    expect(resolveSession(db, secret, now + SESSION_IDLE_MS + 1)).toBeNull();
    db.update(sessions)
      .set({ idleExpiresAt: now + SESSION_ABSOLUTE_MS * 2 })
      .where(eq(sessions.id, hashToken(secret)))
      .run();
    expect(resolveSession(db, secret, now + SESSION_ABSOLUTE_MS + 1)).toBeNull();
  });

  it("returns null for a disabled user", () => {
    const actor = seedUser(db, "gone@example.test");
    const { secret } = createSession(db, (actor as { userId: string }).userId);
    disableUser(db, actor);
    expect(resolveSession(db, secret)).toBeNull();
  });

  it("slides the idle expiry forward, but not more often than SESSION_TOUCH_MS", () => {
    const now = 1_700_000_000_000;
    const { secret } = createSession(db, userId, now);
    const idAt = () => db.select().from(sessions).all()[0]!.idleExpiresAt;
    resolveSession(db, secret, now + 1_000);
    expect(idAt()).toBe(now + SESSION_IDLE_MS); // below the touch floor: no write
    resolveSession(db, secret, now + 120_000);
    expect(idAt()).toBe(now + 120_000 + SESSION_IDLE_MS);
  });

  it("never slides the idle expiry past the absolute expiry", () => {
    const now = 1_700_000_000_000;
    const { secret } = createSession(db, userId, now);
    // A session used continuously up to just before its absolute expiry: earlier touches have
    // already carried the idle expiry to 90 s before it, so the session is still live at `late`
    // and the slide (now + 14 d) has to be clamped rather than written through.
    const late = now + SESSION_ABSOLUTE_MS - 120_000;
    db.update(sessions)
      .set({ idleExpiresAt: now + SESSION_ABSOLUTE_MS - 90_000 })
      .where(eq(sessions.id, hashToken(secret)))
      .run();
    expect(resolveSession(db, secret, late)).not.toBeNull();
    expect(db.select().from(sessions).all()[0]!.idleExpiresAt).toBe(now + SESSION_ABSOLUTE_MS);
  });
});

describe("deleteSession / revokeUserSessions / purgeExpiredSessions", () => {
  it("logout removes exactly that session server-side", () => {
    const a = createSession(db, userId).secret;
    const b = createSession(db, userId).secret;
    deleteSession(db, a);
    expect(resolveSession(db, a)).toBeNull();
    expect(resolveSession(db, b)).not.toBeNull();
  });

  it("revoking removes every session of that user only", () => {
    const other = seedUser(db, "other@example.test");
    const mine = createSession(db, userId).secret;
    const theirs = createSession(db, (other as { userId: string }).userId).secret;
    expect(revokeUserSessions(db, userId)).toBe(1);
    expect(resolveSession(db, mine)).toBeNull();
    expect(resolveSession(db, theirs)).not.toBeNull();
  });

  it("purges rows whose absolute expiry has passed", () => {
    const now = 1_700_000_000_000;
    createSession(db, userId, now);
    expect(purgeExpiredSessions(db, now + SESSION_ABSOLUTE_MS + 1)).toBe(1);
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("purges an idle-expired row whose absolute expiry is still in the future", () => {
    const now = 1_700_000_000_000;
    createSession(db, userId, now);
    const idleGone = now + SESSION_IDLE_MS + 1;
    expect(idleGone).toBeLessThan(now + SESSION_ABSOLUTE_MS);
    expect(purgeExpiredSessions(db, idleGone)).toBe(1);
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("counts only what it actually deleted", () => {
    const now = 1_700_000_000_000;
    createSession(db, userId, now);
    createSession(db, userId, now + SESSION_IDLE_MS); // still live at the purge clock
    expect(purgeExpiredSessions(db, now + SESSION_IDLE_MS + 1)).toBe(1);
    expect(db.select().from(sessions).all()).toHaveLength(1);
  });
});

describe("credentials_changed_at", () => {
  const marker = (id: string) =>
    db.select({ at: users.credentialsChangedAt }).from(users).where(eq(users.id, id)).get()!.at;

  it("is stamped by revokeUserSessions", () => {
    const now = 1_700_000_000_000;
    createSession(db, userId, now);
    expect(marker(userId)).toBeNull();
    expect(revokeUserSessions(db, userId, now + 5)).toBe(1);
    expect(marker(userId)).toBe(now + 5);
  });

  it("rejects a session row that predates the change (login/revoke race)", () => {
    const now = 1_700_000_000_000;
    revokeUserSessions(db, userId, now);
    // A login whose INSERT was in flight while the revoke deleted rows: it survives the DELETE,
    // so only the marker can tell it apart from a session issued after the password change.
    const racing = createSession(db, userId, now - 1_000).secret;
    expect(resolveSession(db, racing, now + 1_000)).toBeNull();
  });

  it("rejects a session created in the same millisecond as the change", () => {
    const now = 1_700_000_000_000;
    revokeUserSessions(db, userId, now);
    // Millisecond resolution cannot order these two, so the tie goes to the revoke.
    expect(resolveSession(db, createSession(db, userId, now).secret, now + 1_000)).toBeNull();
  });

  it("accepts a session created after the change", () => {
    const now = 1_700_000_000_000;
    revokeUserSessions(db, userId, now);
    expect(resolveSession(db, createSession(db, userId, now + 1).secret, now + 1_000)).not.toBeNull();
  });
});

describe("changePassword", () => {
  const stored = (id: string) =>
    db
      .select({ hash: users.passwordHash, changedAt: users.credentialsChangedAt })
      .from(users)
      .where(eq(users.id, id))
      .get()!;

  it("swaps the hash, drops every session and stamps the marker in one step", () => {
    const now = 1_700_000_000_000;
    const a = createSession(db, userId, now - 10).secret;
    const b = createSession(db, userId, now - 5).secret;
    expect(changePassword(db, userId, "new-hash", now)).toBe(2);
    expect(stored(userId)).toEqual({ hash: "new-hash", changedAt: now });
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect(resolveSession(db, a, now)).toBeNull();
    expect(resolveSession(db, b, now)).toBeNull();
  });

  it("leaves another user's sessions and hash alone", () => {
    const other = seedUser(db, "other@example.test");
    const otherId = (other as { userId: string }).userId;
    const keep = createSession(db, otherId).secret;
    changePassword(db, userId, "new-hash", Date.now());
    expect(resolveSession(db, keep)).not.toBeNull();
    expect(stored(otherId).hash).toBe("x");
    expect(stored(otherId).changedAt).toBeNull();
  });
});

describe("createSessionIfCurrent", () => {
  // seedUser stores passwordHash "x" and a null credentials_changed_at — the caller's `expected`
  // here plays the role of "the (passwordHash, credentialsChangedAt) snapshot the login route
  // read in the same query it verified the plaintext password against".
  const initialSnapshot = { passwordHash: "x", credentialsChangedAt: null };

  it("creates the session when the row still matches the snapshot the caller read", () => {
    const created = createSessionIfCurrent(db, userId, initialSnapshot, 1_700_000_000_000);
    expect(created).not.toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(1);
    expect(db.select().from(sessions).all()[0]!.id).toBe(hashToken(created!.secret));
  });

  it("refuses — and inserts no session row — when the hash changed since the caller's snapshot (login-vs-reset race)", () => {
    // A password reset (or self password change) landing strictly between the login route's
    // verifyPassword and its session insert: the hash/marker the caller read is no longer current.
    changePassword(db, userId, "new-hash", 1_700_000_000_000);
    const created = createSessionIfCurrent(db, userId, initialSnapshot, 1_700_000_000_001);
    expect(created).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("refuses when credentials_changed_at moved even though the hash is unchanged (revoke-only write)", () => {
    // revokeUserSessions bumps the marker without touching the hash — the marker moving is what
    // actually matters here, not just the hash column.
    revokeUserSessions(db, userId, 1_700_000_000_000);
    const created = createSessionIfCurrent(db, userId, initialSnapshot, 1_700_000_000_001);
    expect(created).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("accepts when the caller's snapshot already reflects a prior change (no false positive on a fresh, correct read)", () => {
    // Exactly the "reset then immediately log in with the new password" happy path: the caller
    // read the row *after* the change, so its snapshot already matches — this must not be
    // confused with the race case above just because the change is recent.
    changePassword(db, userId, "new-hash", 1_700_000_000_000);
    const created = createSessionIfCurrent(
      db,
      userId,
      { passwordHash: "new-hash", credentialsChangedAt: 1_700_000_000_000 },
      1_700_000_000_000, // even the exact same millisecond as the change — no ambiguity here
    );
    expect(created).not.toBeNull();
  });

  it("refuses for an unknown user", () => {
    expect(createSessionIfCurrent(db, "no-such-user", initialSnapshot)).toBeNull();
  });

  it("refuses for a disabled user", () => {
    disableUser(db, { kind: "user", userId, isAdmin: false });
    expect(createSessionIfCurrent(db, userId, initialSnapshot)).toBeNull();
  });
});
