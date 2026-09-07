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

  it("redacts the SPA's own reset and invite-accept pages (Task 9a routes, no /api prefix)", () => {
    expect(redactPath("/reset/abcDEF123_-xyz")).toBe("/reset/:token");
    expect(redactPath("/invite/abcDEF123_-xyz")).toBe("/invite/:token");
  });

  it("redacts a trailing-junk variant of the SPA paths too", () => {
    expect(redactPath("/reset/abcDEF123_-xyz/")).toBe("/reset/:token");
    expect(redactPath("/invite/abcDEF123_-xyz/")).toBe("/invite/:token");
  });

  it("leaves an unrelated path untouched", () => {
    expect(redactPath("/api/projects/abc-123")).toBe("/api/projects/abc-123");
    expect(redactPath("/api/me")).toBe("/api/me");
    expect(redactPath("/healthz")).toBe("/healthz");
    // Not the SPA's secret routes: must not be caught by the new /reset, /invite patterns.
    expect(redactPath("/reset-password-info")).toBe("/reset-password-info");
    expect(redactPath("/invitations")).toBe("/invitations");
  });
});
