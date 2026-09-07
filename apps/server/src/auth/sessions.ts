import { eq, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { assertNoOpenTransaction, type Tx } from "../db/tx";
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
      createdAt: sessions.createdAt,
      idleExpiresAt: sessions.idleExpiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
      credentialsChangedAt: users.credentialsChangedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  if (now >= row.absoluteExpiresAt || now >= row.idleExpiresAt) return null;
  if (row.disabledAt !== null) return null;
  // A row the revoke's DELETE could not see because its INSERT had not committed yet. The
  // comparison includes equality: created_at has millisecond resolution, so a session stamped
  // in the same millisecond as the change cannot be shown to postdate it — the revoke wins.
  if (row.credentialsChangedAt !== null && row.createdAt <= row.credentialsChangedAt) return null;
  const slid = Math.min(now + SESSION_IDLE_MS, row.absoluteExpiresAt);
  if (slid - row.idleExpiresAt >= SESSION_TOUCH_MS || slid < row.idleExpiresAt) {
    db.update(sessions).set({ idleExpiresAt: slid }).where(eq(sessions.id, id)).run();
  }
  return { userId: row.userId, isAdmin: row.isAdmin };
}

export function deleteSession(db: Db, secret: string): void {
  db.delete(sessions).where(eq(sessions.id, hashToken(secret))).run();
}

/**
 * Password change and admin reset revoke every session of that user (design §4).
 *
 * Opens its own top-level transaction, so it must not be called inside a withProject callback
 * (bun:sqlite has no savepoints here — see db/tx.ts).
 */
export function revokeUserSessions(db: Db, userId: string, now = Date.now()): number {
  assertNoOpenTransaction("revokeUserSessions");
  return db.transaction((tx) => {
    const deleted = tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id }).all();
    // Same transaction as the DELETE: a login committing between the two would otherwise keep a
    // session that the password change was meant to invalidate.
    tx.update(users).set({ credentialsChangedAt: now }).where(eq(users.id, userId)).run();
    return deleted.length;
  }, { behavior: "immediate" });
}

/**
 * A password change is one fact: new hash, no surviving sessions, new generation marker. Split
 * across statements, a login committing between them would keep a session the change was meant
 * to invalidate, so all three go in one immediate transaction.
 *
 * Exported so a caller that already owns a top-level transaction (services/reset.ts's
 * consumeResetToken, which must stamp its token's used_at in the same transaction as the
 * credential change) can fold this in rather than opening a second, nested one — bun:sqlite has
 * no savepoints here (db/tx.ts).
 */
export function changePasswordInTx(tx: Tx, userId: string, passwordHash: string, now: number): number {
  const deleted = tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id }).all();
  tx.update(users).set({ passwordHash, credentialsChangedAt: now }).where(eq(users.id, userId)).run();
  return deleted.length;
}

/**
 * Same rule as revokeUserSessions: hash outside, call this at the top level.
 */
export function changePassword(db: Db, userId: string, passwordHash: string, now: number): number {
  assertNoOpenTransaction("changePassword");
  return db.transaction((tx) => changePasswordInTx(tx, userId, passwordHash, now), { behavior: "immediate" });
}

/** Either expiry passing makes a row dead, so both are swept. */
export function purgeExpiredSessions(db: Db, now = Date.now()): number {
  return db
    .delete(sessions)
    .where(or(lt(sessions.absoluteExpiresAt, now), lt(sessions.idleExpiresAt, now)))
    .returning({ id: sessions.id })
    .all().length;
}
