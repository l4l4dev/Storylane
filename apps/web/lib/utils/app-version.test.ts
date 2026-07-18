import { describe, expect, it } from "vitest";
import { appVersion, formatAppVersion } from "./app-version";

describe("formatAppVersion", () => {
  it("shows the semver with a 7-char short SHA when a commit SHA is present", () => {
    expect(formatAppVersion("0.1.0", "2209663abcdef0123456789")).toBe("v0.1.0 (2209663)");
  });

  it("falls back to a dev marker without a commit SHA", () => {
    expect(formatAppVersion("0.1.0", undefined)).toBe("v0.1.0 (dev)");
  });

  it("appVersion embeds the package.json version", () => {
    expect(appVersion()).toMatch(/^v\d+\.\d+\.\d+ \((dev|[0-9a-f]{7})\)$/);
  });
});
