import { describe, expect, it } from "bun:test";
import { redactPath } from "../src/log";

describe("redactPath", () => {
  it("redacts a preview path", () => {
    expect(redactPath("/api/invites/abcDEF123_-xyz")).toBe("/api/invites/:token");
  });

  it("redacts an accept path", () => {
    expect(redactPath("/api/invites/abcDEF123_-xyz/accept")).toBe("/api/invites/:token/accept");
  });

  it("redacts a reset-token path", () => {
    expect(redactPath("/api/auth/reset/abcDEF123_-xyz")).toBe("/api/auth/reset/:token");
  });

  it("redacts a trailing-junk variant so a stray slash cannot smuggle the token past the mask", () => {
    expect(redactPath("/api/auth/reset/abcDEF123_-xyz/")).toBe("/api/auth/reset/:token");
    expect(redactPath("/api/invites/abcDEF123_-xyz/")).toBe("/api/invites/:token");
  });

  it("leaves an unrelated path untouched", () => {
    expect(redactPath("/api/projects/abc-123")).toBe("/api/projects/abc-123");
    expect(redactPath("/api/me")).toBe("/api/me");
    expect(redactPath("/healthz")).toBe("/healthz");
  });
});
