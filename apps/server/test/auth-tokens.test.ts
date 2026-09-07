import { describe, expect, it } from "bun:test";
import { hashToken, newSecret, tokensMatch } from "../src/auth/tokens";

describe("newSecret", () => {
  it("is 32 bytes of base64url with no padding", () => {
    const secret = newSecret();
    expect(secret).toHaveLength(43); // ceil(32 * 4 / 3) with the padding dropped
    expect(secret).not.toContain("=");
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 100 }, () => newSecret()));
    expect(seen.size).toBe(100);
  });

  it("honours a custom byte length", () => {
    expect(newSecret(16)).toHaveLength(22);
  });
});

describe("hashToken", () => {
  it("is 64 lowercase hex characters", () => {
    expect(hashToken(newSecret())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic, and differs for different secrets", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("tokensMatch", () => {
  it("is true only for the same hash", () => {
    const a = hashToken("one");
    expect(tokensMatch(a, hashToken("one"))).toBe(true);
    expect(tokensMatch(a, hashToken("two"))).toBe(false);
  });

  it("returns false rather than throwing on unequal length, empty or non-hex input", () => {
    const a = hashToken("one");
    expect(tokensMatch(a, a.slice(0, 32))).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
    expect(tokensMatch(a, "")).toBe(false);
    // Buffer.from(..., "hex") stops at the first invalid pair instead of throwing, so these
    // decode short and must be rejected on length rather than blowing up in timingSafeEqual.
    expect(tokensMatch(a, "zz".repeat(32))).toBe(false);
    expect(tokensMatch("zz".repeat(32), "zz".repeat(32))).toBe(false);
    expect(tokensMatch(a, "not hex at all")).toBe(false);
  });
});
