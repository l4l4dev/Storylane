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

export function setupTokenMatches(tx: Tx, token: string, now: number): boolean {
  const read = (key: string) => tx.select({ value: instanceMeta.value }).from(instanceMeta).where(eq(instanceMeta.key, key)).get()?.value;
  const stored = read(SETUP_TOKEN_HASH_KEY);
  const expiresAt = Number(read(SETUP_TOKEN_EXPIRES_KEY) ?? "0");
  if (!stored || !Number.isFinite(expiresAt) || now >= expiresAt) return false;
  return tokensMatch(stored, hashToken(token));
}

export function clearSetupToken(tx: Tx): void {
  tx.delete(instanceMeta).where(inArray(instanceMeta.key, [SETUP_TOKEN_HASH_KEY, SETUP_TOKEN_EXPIRES_KEY])).run();
}
