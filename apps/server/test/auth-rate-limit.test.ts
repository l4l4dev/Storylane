import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { clientIp, createRateLimiter, MAX_KEYS } from "../src/auth/rate-limit";

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

  it("evicts the oldest bucket once the key cap is reached", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => clock });
    limiter.check("a");
    clock = 1;
    limiter.check("b");
    clock = 2;
    // "c" pushes the map past the cap, so the oldest bucket ("a") is dropped.
    limiter.check("c");
    expect(limiter.hits("a")).toBe(0);
    expect(limiter.hits("b")).toBe(1);
    expect(limiter.hits("c")).toBe(1);
    // A key whose window rolled over counts as freshly seen, so it is not the next eviction.
    clock = 2000;
    limiter.check("b");
    clock = 2001;
    limiter.check("d");
    expect(limiter.hits("b")).toBe(1);
    expect(limiter.hits("c")).toBe(0);
  });

  it("keeps the default cap at MAX_KEYS", () => {
    expect(MAX_KEYS).toBe(10_000);
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

  it("uses the right-most X-Forwarded-For entry when trusted", async () => {
    // Only the last entry was appended by our own proxy; everything left of it is
    // client-supplied and would otherwise let one attacker spread over unlimited buckets.
    expect(await ipOf({ STORYLANE_TRUST_PROXY: "true" }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe(
      "10.0.0.1",
    );
  });

  it("falls back to a stable placeholder when no address is available", async () => {
    // app.request() has no socket, so this documents the fallback rather than a real address.
    expect(await ipOf({}, {})).toBe("unknown");
  });
});
