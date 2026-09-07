import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/tx";
import { instanceMeta, users } from "../db/schema";
import { hashToken, newSecret, tokensMatch } from "../auth/tokens";
import type { Logger } from "../log";

export const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;
export const SETUP_TOKEN_HASH_KEY = "setup_token_hash";
export const SETUP_TOKEN_EXPIRES_KEY = "setup_token_expires_at";

export function hasAnyUser(db: Db): boolean {
  return db.select({ id: users.id }).from(users).limit(1).get() !== undefined;
}

/**
 * Called once per boot. While the instance has no user it prints a fresh single-use token to
 * stdout (the operator reads it from `docker logs`); a token from a previous boot is replaced,
 * so a log line an attacker saw an hour ago is worthless.
 */
export function ensureSetupToken(db: Db, log: Logger, now = Date.now()): string | null {
  if (hasAnyUser(db)) {
    db.delete(instanceMeta)
      .where(inArray(instanceMeta.key, [SETUP_TOKEN_HASH_KEY, SETUP_TOKEN_EXPIRES_KEY]))
      .run();
    return null;
  }
  const token = newSecret();
  const expiresAt = now + SETUP_TOKEN_TTL_MS;
  const put = (key: string, value: string) =>
    db
      .insert(instanceMeta)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: instanceMeta.key, set: { value, updatedAt: now } })
      .run();
  put(SETUP_TOKEN_HASH_KEY, hashToken(token));
  put(SETUP_TOKEN_EXPIRES_KEY, String(expiresAt));
  log.info("setup token", { token, expires_at: new Date(expiresAt).toISOString() });
  return token;
}

/** Shared by setupTokenMatches (tx) and peekSetupToken (plain db) — Tx and Db are not mutually
 * assignable (a transaction handle carries extra members a plain Db lacks), so the read is
 * written once against a structural `{ select }` and each caller passes its own handle. */
function readTokenRow(reader: Pick<Db, "select">, key: string): string | undefined {
  return reader.select({ value: instanceMeta.value }).from(instanceMeta).where(eq(instanceMeta.key, key)).get()?.value;
}

function tokenIsValid(read: (key: string) => string | undefined, token: string, now: number): boolean {
  const stored = read(SETUP_TOKEN_HASH_KEY);
  const expiresAt = Number(read(SETUP_TOKEN_EXPIRES_KEY) ?? "0");
  if (!stored || !Number.isFinite(expiresAt) || now >= expiresAt) return false;
  return tokensMatch(stored, hashToken(token));
}

export function setupTokenMatches(tx: Tx, token: string, now: number): boolean {
  return tokenIsValid((key) => readTokenRow(tx, key), token, now);
}

/**
 * Read-only equivalent of setupTokenMatches against the plain (non-transactional) db handle:
 * a cheap check the POST /api/setup route runs before the KDF, so a wrong token never reaches
 * argon2id. Not authoritative — completeSetup re-checks inside its transaction, which is what
 * actually guards against a concurrent second submission.
 */
export function peekSetupToken(db: Db, token: string, now: number): boolean {
  return tokenIsValid((key) => readTokenRow(db, key), token, now);
}

export function clearSetupToken(tx: Tx): void {
  tx.delete(instanceMeta).where(inArray(instanceMeta.key, [SETUP_TOKEN_HASH_KEY, SETUP_TOKEN_EXPIRES_KEY])).run();
}
