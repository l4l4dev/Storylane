import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { clientIp, createRateLimiter } from "../src/auth/rate-limit";

describe("createRateLimiter", () => {
  it("allows `limit` attempts per window, then blocks", () => {
    const clock = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => clock });
    expect([limiter.check("a"), limiter.check("a"), limiter.check("a")]).toEqual([true, true, true]);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(true);
  });

  it("forgets a key once its window rolls over", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    clock = 1001;
    expect(limiter.check("a")).toBe(true);
  });

  it("reset clears one key or everything", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check("a");
    limiter.reset("a");
    expect(limiter.check("a")).toBe(true);
    limiter.check("a");
    limiter.reset();
    expect(limiter.check("a")).toBe(true);
  });

  it("counts hits past the limit", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check("a");
    limiter.check("a");
    expect(limiter.hits("a")).toBe(2);
    expect(limiter.hits("b")).toBe(0);
  });
});

describe("clientIp", () => {
  const ipOf = (env: Record<string, string>, headers: Record<string, string>) => {
    const config = loadConfig(env);
    const app = new Hono().get("/ip", (c) => c.text(clientIp(c, config)));
    // app.request() may answer synchronously for a sync handler, so it is not always a Promise.
    return Promise.resolve(app.request("http://127.0.0.1/ip", { headers })).then((r) => r.text());
  };

  it("ignores X-Forwarded-For unless the proxy is trusted", async () => {
    expect(await ipOf({}, { "x-forwarded-for": "203.0.113.9" })).not.toBe("203.0.113.9");
  });

  it("uses the left-most X-Forwarded-For entry when trusted", async () => {
    expect(await ipOf({ STORYLANE_TRUST_PROXY: "true" }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to a stable placeholder when no address is available", async () => {
    // app.request() has no socket, so this documents the fallback rather than a real address.
    expect(await ipOf({}, {})).toBe("unknown");
  });
});
