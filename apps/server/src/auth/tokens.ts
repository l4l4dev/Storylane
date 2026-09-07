import { timingSafeEqual } from "node:crypto";
import { HttpError } from "../http-error";

/** 256 bits of randomness, URL-safe: session ids, invite tokens, reset tokens, setup token. */
export function newSecret(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return Buffer.from(raw).toString("base64url");
}

/**
 * newSecret()'s own output is 43 chars (32 bytes, base64url, no padding); nothing this codebase
 * mints is ever remotely close to this. A public token-in-path route (invites, reset) answers
 * the same uniform 404 as any other unusable token for anything past this, checked before the
 * value ever reaches `hashToken` — an attacker choosing an arbitrarily long path segment must
 * not be able to make the server hash it (cheap, but still unbounded work per request) or grow
 * a rate-limit/log line with it.
 */
export const MAX_TOKEN_LENGTH = 128;

/** Route-level guard for every `:token` path param before it reaches hashToken. */
export function assertTokenLength(token: string): void {
  if (token.length > MAX_TOKEN_LENGTH) throw new HttpError(404, "not_found");
}

/** Secrets are stored only as this. Unsalted SHA-256 is right here: the input is 256-bit random. */
export function hashToken(secret: string): string {
  return new Bun.CryptoHasher("sha256").update(secret).digest("hex");
}

export function tokensMatch(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
