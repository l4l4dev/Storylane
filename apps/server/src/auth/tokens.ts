import { timingSafeEqual } from "node:crypto";

/** 256 bits of randomness, URL-safe: session ids, invite tokens, reset tokens, setup token. */
export function newSecret(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return Buffer.from(raw).toString("base64url");
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
