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
  app.post("/api/projects/:id/stories/:storyId/comments/:commentId/attachments", (c) => c.json({ ok: true }));
  app.post("/api/projects/:id/stories/:storyId/comments", (c) => c.json({ ok: true }));
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

  it("leaves GET alone, and lets a cookie-less request with no Origin through", async () => {
    const get = await appWith().request("http://tracker.example.test/api/thing", {
      headers: { ...withCookie, origin: "http://evil.example.test" },
    });
    expect(get.status).toBe(200);
    // curl/CLI login: no cookie and no Origin at all. A browser always sends Origin on a
    // cross-site POST, so allowing this does not open a CSRF path.
    const cli = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...json },
      body: "{}",
    });
    expect(cli.status).toBe(200);
  });

  it("rejects a foreign Origin even without a session cookie", async () => {
    // The login route itself: a cross-site page must not be able to POST credentials, or a
    // forced login lands the victim in the attacker's account.
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...json, origin: "https://evil.example" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_check_failed" });
  });

  it("rejects a non-JSON content type even without a session cookie", async () => {
    // text/plain is one of the content types a no-cors form POST can send.
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("guards every unsafe method, not only POST", async () => {
    const app = appWith();
    app.delete("/api/thing", (c) => c.json({ ok: true }));
    app.patch("/api/thing", (c) => c.json({ ok: true }));
    for (const method of ["DELETE", "PATCH"]) {
      const res = await app.request("http://tracker.example.test/api/thing", {
        method,
        headers: { ...withCookie, ...json, origin: "https://evil.example" },
        body: "{}",
      });
      expect(res.status).toBe(403);
    }
  });

  it("accepts the forwarded origin behind a trusted TLS-terminating proxy", async () => {
    const app = appWith({ STORYLANE_TRUST_PROXY: "true" });
    const good = await app.request("http://10.0.0.5:3000/api/thing", {
      method: "POST",
      headers: {
        ...withCookie,
        ...json,
        origin: "https://tracker.example.test",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "tracker.example.test",
      },
      body: "{}",
    });
    expect(good.status).toBe(200);
    const bad = await app.request("http://10.0.0.5:3000/api/thing", {
      method: "POST",
      headers: {
        ...withCookie,
        ...json,
        origin: "https://evil.example",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "tracker.example.test",
      },
      body: "{}",
    });
    expect(bad.status).toBe(403);
  });

  it("ignores the forwarded headers when the proxy is not trusted", async () => {
    const res = await appWith().request("http://10.0.0.5:3000/api/thing", {
      method: "POST",
      headers: {
        ...withCookie,
        ...json,
        origin: "https://evil.example",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil.example",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
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

  describe("octet-stream upload allowance", () => {
    const origin = "http://tracker.example.test";
    const upload = `${origin}/api/projects/p/stories/s/comments/c/attachments`;
    const octet = { "content-type": "application/octet-stream" };

    it("accepts octet-stream on the upload path with a matching Origin", async () => {
      const res = await appWith().request(upload, {
        method: "POST",
        headers: { ...withCookie, ...octet, origin },
        body: "bytes",
      });
      expect(res.status).toBe(200);
    });

    it("rejects octet-stream on the upload path with a foreign Origin", async () => {
      const res = await appWith().request(upload, {
        method: "POST",
        headers: { ...withCookie, ...octet, origin: "http://evil.example.test" },
        body: "bytes",
      });
      expect(res.status).toBe(403);
    });

    it("rejects octet-stream with a cookie but neither Origin nor Sec-Fetch-Site", async () => {
      const res = await appWith().request(upload, { method: "POST", headers: { ...withCookie, ...octet }, body: "b" });
      expect(res.status).toBe(403);
    });

    it("rejects octet-stream on any other path", async () => {
      for (const path of ["/api/projects/p/stories/s/comments", "/api/thing", "/api/projects/p/stories/s/comments/c/attachments/x"]) {
        const res = await appWith().request(`${origin}${path}`, {
          method: "POST",
          headers: { ...withCookie, ...octet, origin },
          body: "bytes",
        });
        expect(res.status).toBe(403);
      }
    });

    it("rejects octet-stream on the upload path with a method other than POST", async () => {
      const res = await appWith().request(upload, {
        method: "PUT",
        headers: { ...withCookie, ...octet, origin },
        body: "bytes",
      });
      expect(res.status).toBe(403);
    });

    it("rejects text/plain and a missing content type on the upload path", async () => {
      // A Uint8Array body, because a string body would make Request add text/plain on its own.
      for (const headers of [{ "content-type": "text/plain" }, {}]) {
        const req = new Request(upload, {
          method: "POST",
          headers: { ...withCookie, ...headers, origin },
          body: new TextEncoder().encode("bytes"),
        });
        expect(req.headers.get("content-type")).toBe("content-type" in headers ? "text/plain" : null);
        const res = await appWith().request(req);
        expect(res.status).toBe(403);
      }
    });

    it("rejects multipart/form-data on the upload path", async () => {
      const res = await appWith().request(upload, {
        method: "POST",
        headers: { ...withCookie, "content-type": "multipart/form-data; boundary=x", origin },
        body: "--x--",
      });
      expect(res.status).toBe(403);
    });
  });
});
