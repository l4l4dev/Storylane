import { describe, expect, it } from "bun:test";
import {
  ARGON2_PARAMS,
  assertPasswordAcceptable,
  hashPassword,
  verifyPassword,
  kdfStats,
  resetKdfPeak,
  KDF_MAX_CONCURRENCY,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../src/auth/password";
import { HttpError } from "../src/http-error";

// Argon2id at the production cost takes ~100 ms per call; the tests that only care about
// round-tripping use a cheap parameter set. verifyPassword reads the cost from the hash.
const CHEAP = { algorithm: "argon2id", memoryCost: 1024, timeCost: 1 } as const;

describe("password hashing", () => {
  it("produces an argon2id hash that verifies", async () => {
    const hash = await hashPassword("correct horse battery", CHEAP);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong horse battery")).toBe(false);
  });

  it("salts: the same password hashes differently every time", async () => {
    const a = await hashPassword("correct horse battery", CHEAP);
    const b = await hashPassword("correct horse battery", CHEAP);
    expect(a).not.toBe(b);
  });

  it("uses the documented production parameters by default", () => {
    expect(ARGON2_PARAMS).toEqual({ algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
  });

  it("returns false instead of throwing on a corrupt hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });

  it("enforces a minimum length and nothing else", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(() => assertPasswordAcceptable("x".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
    expectRejection(() => assertPasswordAcceptable("short"), "password_too_short");
  });

  it("rejects an absurdly long password (argon2 cost is linear in the input)", () => {
    expect(MAX_PASSWORD_LENGTH).toBe(1024);
    expect(() => assertPasswordAcceptable("x".repeat(MAX_PASSWORD_LENGTH))).not.toThrow();
    expectRejection(() => assertPasswordAcceptable("x".repeat(MAX_PASSWORD_LENGTH + 1)), "password_too_long");
  });

  it("counts code points, not UTF-16 units: 12 emoji are long enough", () => {
    const emoji = "\u{1f600}".repeat(MIN_PASSWORD_LENGTH);
    expect(emoji.length).toBeGreaterThan(MIN_PASSWORD_LENGTH); // 24 UTF-16 units, 12 code points
    expect(() => assertPasswordAcceptable(emoji)).not.toThrow();
    // ...and 11 of them are not, however many UTF-16 units that is.
    expectRejection(() => assertPasswordAcceptable("\u{1f600}".repeat(MIN_PASSWORD_LENGTH - 1)), "password_too_short");
  });

  it("enforces the bounds itself, so no caller can store an unchecked password", async () => {
    await expect(hashPassword("short", CHEAP)).rejects.toMatchObject({ status: 400, code: "password_too_short" });
    await expect(hashPassword("x".repeat(MAX_PASSWORD_LENGTH + 1), CHEAP)).rejects.toMatchObject({
      status: 400,
      code: "password_too_long",
    });
  });
});

describe("KDF concurrency cap", () => {
  it("runs at most KDF_MAX_CONCURRENCY hashes at once and still resolves all of them", async () => {
    expect(KDF_MAX_CONCURRENCY).toBe(4);
    resetKdfPeak();
    expect(kdfStats().inFlight).toBe(0);
    const started = Array.from({ length: 6 }, (_, i) => hashPassword(`passphrase-number-${i}`, CHEAP));
    const hashes = await Promise.all(started);
    expect(hashes).toHaveLength(6);
    expect(new Set(hashes).size).toBe(6);
    expect(kdfStats().peak).toBe(KDF_MAX_CONCURRENCY);
    expect(kdfStats().inFlight).toBe(0);
  });

  it("releases its slot when the KDF throws", async () => {
    resetKdfPeak();
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
    expect(kdfStats().inFlight).toBe(0);
  });
});

function expectRejection(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error("expected a throw");
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(400);
    expect((e as HttpError).code).toBe(code);
  }
}
