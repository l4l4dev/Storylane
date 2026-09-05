import { describe, expect, it } from "bun:test";
import { loadConfig, ConfigError } from "../src/config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.dataDir).toBe("/data");
    expect(c.baseUrl).toBeNull();
    expect(c.trustProxy).toBe(false);
  });
  it("reads every STORYLANE_* variable", () => {
    const c = loadConfig({
      STORYLANE_PORT: "8080",
      STORYLANE_DATA_DIR: "/tmp/sl",
      STORYLANE_BASE_URL: "https://tracker.example.org",
      STORYLANE_TRUST_PROXY: "true",
    });
    expect(c.port).toBe(8080);
    expect(c.dataDir).toBe("/tmp/sl");
    expect(c.baseUrl?.origin).toBe("https://tracker.example.org");
    expect(c.trustProxy).toBe(true);
  });
  it("rejects a bad port", () => {
    expect(() => loadConfig({ STORYLANE_PORT: "eighty" })).toThrow(ConfigError);
    expect(() => loadConfig({ STORYLANE_PORT: "70000" })).toThrow(ConfigError);
  });
  it("rejects a relative or non-http base URL", () => {
    expect(() => loadConfig({ STORYLANE_BASE_URL: "tracker.example.org" })).toThrow(ConfigError);
    expect(() => loadConfig({ STORYLANE_BASE_URL: "ftp://x" })).toThrow(ConfigError);
  });
  it("rejects an unknown boolean", () => {
    expect(() => loadConfig({ STORYLANE_TRUST_PROXY: "yes" })).toThrow(ConfigError);
  });
});
