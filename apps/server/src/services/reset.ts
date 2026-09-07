import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { resetTokens, users } from "../db/schema";
import { assertNoOpenTransaction, type UserActor } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { hashToken, newSecret } from "../auth/tokens";
import { changePasswordInTx } from "../auth/sessions";

export const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Admins mint a link and hand it over out of band; they never set a password themselves.
 * A disabled account 404s here the same as an unknown one: `user:deactivate` (spec/permissions.md
 * "Instance admin plane") must not be reachable around by minting a link for its credentials.
 */
export function mintResetToken(db: Db, admin: UserActor, userId: string, now = Date.now()): { token: string; expiresAt: number } {
  const user = db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.disabledAt))).get();
  if (!user) throw new HttpError(404, "not_found");
  const token = newSecret();
  const expiresAt = now + RESET_TTL_MS;
  db.insert(resetTokens)
    .values({ id: newId(), userId, tokenHash: hashToken(token), createdBy: admin.userId, createdAt: now, expiresAt })
    .run();
  return { token, expiresAt };
}

/**
 * `reader` is `{ select }` rather than `Db`, so a caller inside a transaction passes its own
 * `tx` (never the plain `db`) — same split as invites.ts's usable/readTokenRow.
 */
function usable(reader: Pick<Db, "select">, token: string, now: number) {
  const row = reader
    .select({
      id: resetTokens.id,
      userId: resetTokens.userId,
      expiresAt: resetTokens.expiresAt,
      usedAt: resetTokens.usedAt,
      email: users.email,
      disabledAt: users.disabledAt,
    })
    .from(resetTokens)
    .innerJoin(users, eq(users.id, resetTokens.userId))
    .where(eq(resetTokens.tokenHash, hashToken(token)))
    .get();
  if (!row || row.usedAt !== null || now >= row.expiresAt || row.disabledAt !== null) return null;
  return row;
}

export function previewResetToken(db: Db, token: string, now = Date.now()): { email: string } | null {
  const row = usable(db, token, now);
  return row ? { email: row.email } : null;
}

/**
 * Single use, and every session of that user goes (design §4). The hash is made by the route,
 * outside this transaction: bun:sqlite transactions here are synchronous, hashPassword is not.
 * `now` must be taken by the caller *after* hashPassword resolves: `credentials_changed_at` has
 * to postdate every session that could have been created while the KDF was running, the same
 * ordering `/api/me/password` already relies on.
 *
 * The token recheck, the used_at stamp and the credential change (changePasswordInTx) are one
 * immediate transaction: split across two, a second use committing between them could reuse a
 * token this call had already validated, or leave the credential change applied without the
 * token ever being marked spent.
 *
 * Every other unused, unexpired reset token minted for this user is spent in the same
 * transaction: leaving a second live link outstanding would let whoever holds it overwrite the
 * password this call just set.
 */
export function consumeResetToken(db: Db, token: string, passwordHash: string, now = Date.now()): { userId: string } {
  assertNoOpenTransaction("consumeResetToken");
  return db.transaction(
    (tx) => {
      const row = usable(tx, token, now);
      if (!row) throw new HttpError(404, "not_found");
      tx.update(resetTokens)
        .set({ usedAt: now })
        .where(and(eq(resetTokens.userId, row.userId), isNull(resetTokens.usedAt)))
        .run();
      changePasswordInTx(tx, row.userId, passwordHash, now);
      return { userId: row.userId };
    },
    { behavior: "immediate" },
  );
}

/**
 * Same shape as purgeExpiredSessions: a dead reset token (already used, or past its own
 * expiry — `usable()` already refuses both) is only ever a row this table doesn't need to keep
 * growing, never a security backstop.
 */
export function purgeExpiredResetTokens(db: Db, now = Date.now()): number {
  return db
    .delete(resetTokens)
    .where(or(lt(resetTokens.expiresAt, now), isNotNull(resetTokens.usedAt)))
    .returning({ id: resetTokens.id })
    .all().length;
}
