import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { clearSessionCookie, isSecureRequest, readSessionCookie, setSessionCookie } from "../src/auth/cookies";
import { SESSION_COOKIE } from "../src/auth/sessions";

function appWith(env: Record<string, string>) {
  const config = loadConfig(env);
  return new Hono()
    .get("/set", (c) => {
      setSessionCookie(c, config, "secret-value", Date.parse("2027-01-01T00:00:00Z"));
      return c.json({ secure: isSecureRequest(c, config) });
    })
    .get("/clear", (c) => {
      clearSessionCookie(c, config);
      return c.body(null, 204);
    })
    .get("/read", (c) => c.json({ secret: readSessionCookie(c) }));
}

describe("session cookie", () => {
  it("omits Secure on plain http (the LAN case)", async () => {
    const res = await appWith({}).request("http://192.168.1.5:3000/set");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=secret-value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    expect(await res.json()).toEqual({ secure: false });
  });

  it("sets Secure when STORYLANE_BASE_URL is https", async () => {
    const res = await appWith({ STORYLANE_BASE_URL: "https://tracker.example.test" }).request("http://127.0.0.1/set");
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("sets Secure behind a trusted proxy that reports https", async () => {
    const res = await appWith({ STORYLANE_TRUST_PROXY: "true" }).request("http://127.0.0.1/set", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("reads the right-most X-Forwarded-Proto, the one the trusted proxy appended", async () => {
    const secure = await appWith({ STORYLANE_TRUST_PROXY: "true" }).request("http://127.0.0.1/set", {
      headers: { "x-forwarded-proto": "http, https" },
    });
    expect(secure.headers.get("set-cookie")).toContain("Secure");
    const forged = await appWith({ STORYLANE_TRUST_PROXY: "true" }).request("http://127.0.0.1/set", {
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(forged.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("ignores X-Forwarded-Proto when the proxy is not trusted", async () => {
    const res = await appWith({}).request("http://127.0.0.1/set", { headers: { "x-forwarded-proto": "https" } });
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("takes the first of a duplicated cookie instead of throwing", async () => {
    // A stale cookie on a parent domain or path can make the browser send the name twice; the
    // request must resolve to one string, and an unparseable pair must not reach the KDF.
    const res = await appWith({}).request("http://127.0.0.1/read", {
      headers: { cookie: `${SESSION_COOKIE}=first; other=1; ${SESSION_COOKIE}=second` },
    });
    // Hono's getCookie returns the first occurrence (verified against hono 4.13 in this repo);
    // either choice is safe here because a wrong value simply fails to resolve to a session.
    expect(await res.json()).toEqual({ secret: "first" });
  });

  it("clears with Max-Age=0 and reads back a cookie", async () => {
    const cleared = await appWith({}).request("http://127.0.0.1/clear");
    expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0");
    const read = await appWith({}).request("http://127.0.0.1/read", {
      headers: { cookie: `${SESSION_COOKIE}=abc; other=1` },
    });
    expect(await read.json()).toEqual({ secret: "abc" });
  });
});
