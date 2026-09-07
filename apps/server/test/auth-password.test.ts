import { describe, expect, it } from "bun:test";
import { ARGON2_PARAMS, assertPasswordAcceptable, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "../src/auth/password";
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
    try {
      assertPasswordAcceptable("short");
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).code).toBe("password_too_short");
    }
  });
});
