import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { hashToken, newSecret } from "./tokens";

export const SESSION_COOKIE = "storylane_session";
/** Design §4 asks for absolute + idle expiry; the numbers are this project's choice. */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
/** Do not rewrite the idle expiry on every request — once a minute is plenty. */
export const SESSION_TOUCH_MS = 60_000;

export interface SessionUser {
  userId: string;
  isAdmin: boolean;
}

export function createSession(db: Db, userId: string, now = Date.now()): { secret: string; absoluteExpiresAt: number } {
  const secret = newSecret();
  const absoluteExpiresAt = now + SESSION_ABSOLUTE_MS;
  db.insert(sessions)
    .values({
      id: hashToken(secret),
      userId,
      createdAt: now,
      idleExpiresAt: now + SESSION_IDLE_MS,
      absoluteExpiresAt,
    })
    .run();
  return { secret, absoluteExpiresAt };
}

export function resolveSession(db: Db, secret: string, now = Date.now()): SessionUser | null {
  const id = hashToken(secret);
  const row = db
    .select({
      userId: sessions.userId,
      idleExpiresAt: sessions.idleExpiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  if (now >= row.absoluteExpiresAt || now >= row.idleExpiresAt) return null;
  if (row.disabledAt !== null) return null;
  const slid = Math.min(now + SESSION_IDLE_MS, row.absoluteExpiresAt);
  if (slid - row.idleExpiresAt >= SESSION_TOUCH_MS || slid < row.idleExpiresAt) {
    db.update(sessions).set({ idleExpiresAt: slid }).where(eq(sessions.id, id)).run();
  }
  return { userId: row.userId, isAdmin: row.isAdmin };
}

export function deleteSession(db: Db, secret: string): void {
  db.delete(sessions).where(eq(sessions.id, hashToken(secret))).run();
}

/** Password change and admin reset revoke every session of that user (design §4). */
export function revokeUserSessions(db: Db, userId: string): number {
  const doomed = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  return doomed.length;
}

export function purgeExpiredSessions(db: Db, now = Date.now()): number {
  const doomed = db.select({ id: sessions.id }).from(sessions).where(lt(sessions.absoluteExpiresAt, now)).all();
  db.delete(sessions).where(lt(sessions.absoluteExpiresAt, now)).run();
  return doomed.length;
}
