import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { csrfGuard } from "../src/auth/csrf";
import { SESSION_COOKIE } from "../src/auth/sessions";
import { HttpError } from "../src/http-error";

function appWith(env: Record<string, string> = {}) {
  const config = loadConfig(env);
  const app = new Hono();
  app.use("/api/*", csrfGuard(config));
  app.post("/api/thing", (c) => c.json({ ok: true }));
  app.get("/api/thing", (c) => c.json({ ok: true }));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code }, err.status as 400);
    throw err;
  });
  return app;
}

const withCookie = { cookie: `${SESSION_COOKIE}=abc` };
const json = { "content-type": "application/json" };

describe("csrfGuard", () => {
  it("accepts a same-origin JSON POST from a cookie session", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "http://tracker.example.test" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("rejects a foreign Origin", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "http://evil.example.test" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_check_failed" });
  });

  it("rejects a cookie POST with a form content type", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: {
        ...withCookie,
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://tracker.example.test",
      },
      body: "a=1",
    });
    expect(res.status).toBe(403);
  });

  it("accepts Sec-Fetch-Site: same-origin when Origin is absent", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, "sec-fetch-site": "same-origin" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("rejects a cookie POST with neither Origin nor Sec-Fetch-Site", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("leaves GET and cookie-less requests alone", async () => {
    const get = await appWith().request("http://tracker.example.test/api/thing", {
      headers: { ...withCookie, origin: "http://evil.example.test" },
    });
    expect(get.status).toBe(200);
    const anonymous = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...json },
      body: "{}",
    });
    expect(anonymous.status).toBe(200);
  });

  it("compares against STORYLANE_BASE_URL when it is set", async () => {
    const app = appWith({ STORYLANE_BASE_URL: "https://tracker.example.test" });
    const good = await app.request("http://10.0.0.5:3000/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "https://tracker.example.test" },
      body: "{}",
    });
    expect(good.status).toBe(200);
    const bad = await app.request("http://10.0.0.5:3000/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "http://10.0.0.5:3000" },
      body: "{}",
    });
    expect(bad.status).toBe(403);
  });
});
