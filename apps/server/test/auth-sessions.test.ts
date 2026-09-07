import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, disableUser, seedUser } from "./harness";
import { hashToken } from "../src/auth/tokens";
import {
  createSession,
  deleteSession,
  purgeExpiredSessions,
  resolveSession,
  revokeUserSessions,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "../src/auth/sessions";
import { sessions } from "../src/db/schema";
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
});
