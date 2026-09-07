import { beforeEach, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { makeTestApp, makeTestDb, seedUserWithPassword, disableUser, seedProject, loginAs } from "./harness";
import { SESSION_COOKIE } from "../src/auth/sessions";
import { sessions } from "../src/db/schema";
import { ABSENT_USER_HASH } from "../src/routes/auth";
import { ARGON2_PARAMS, MAX_PASSWORD_LENGTH } from "../src/auth/password";
import type { Db } from "../src/db/client";

let db: Db;
const PASSWORD = "correct horse battery";
const ORIGIN = "http://127.0.0.1";

const post = (app: Hono, path: string, body: unknown, cookie?: string, origin = ORIGIN) =>
  Promise.resolve(
    app.request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const get = (app: Hono, path: string, cookie?: string) =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} }));

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

beforeEach(async () => {
  db = makeTestDb();
  await seedUserWithPassword(db, "owner@example.test", PASSWORD);
});

describe("POST /api/auth/login", () => {
  it("sets a session cookie and returns the user", async () => {
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "owner@example.test", displayName: "owner", isAdmin: false });
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(db.select().from(sessions).all()).toHaveLength(1);
  });

  it("matches the email case-insensitively", async () => {
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/auth/login", { email: "OWNER@Example.TEST", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("trims surrounding whitespace from the email, symmetric with invite registration", async () => {
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/auth/login", { email: "  owner@example.test  ", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("rejects a body without an email or password with 400", async () => {
    const { app } = makeTestApp(db);
    expect((await post(app, "/api/auth/login", { password: PASSWORD })).status).toBe(400);
    expect((await post(app, "/api/auth/login", { email: "owner@example.test" })).status).toBe(400);
  });

  it("answers one uniform message for a wrong password, an unknown email and a disabled user", async () => {
    const disabled = await seedUserWithPassword(db, "gone@example.test", PASSWORD);
    disableUser(db, disabled);
    const { app } = makeTestApp(db);
    const wrong = await post(app, "/api/auth/login", { email: "owner@example.test", password: "nope nope nope" });
    const unknown = await post(app, "/api/auth/login", { email: "nobody@example.test", password: PASSWORD });
    const off = await post(app, "/api/auth/login", { email: "gone@example.test", password: PASSWORD });
    for (const res of [wrong, unknown, off]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_credentials" });
    }
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("blocks after LOGIN_LIMITS.perEmail failures and keeps another email working", async () => {
    await seedUserWithPassword(db, "second@example.test", PASSWORD);
    const { app } = makeTestApp(db);
    for (let i = 0; i < 5; i++) await post(app, "/api/auth/login", { email: "owner@example.test", password: "bad" });
    const blocked = await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_requests" });
    const other = await post(app, "/api/auth/login", { email: "second@example.test", password: PASSWORD });
    expect(other.status).toBe(200);
  });

  it("clears the per-email counter on a successful login", async () => {
    const { app } = makeTestApp(db);
    for (let i = 0; i < 4; i++) await post(app, "/api/auth/login", { email: "owner@example.test", password: "bad" });
    expect((await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < 4; i++) await post(app, "/api/auth/login", { email: "owner@example.test", password: "bad" });
    expect((await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD })).status).toBe(200);
  });

  it("rotates: a session presented on a successful login is replaced", async () => {
    const { app } = makeTestApp(db);
    const old = await loginAs(app, "owner@example.test", PASSWORD);
    expect((await get(app, "/api/me", old)).status).toBe(200);
    const fresh = cookieFrom(
      await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }, old),
    );
    expect(fresh).not.toBe(old);
    expect((await get(app, "/api/me", old)).status).toBe(401);
    expect((await get(app, "/api/me", fresh)).status).toBe(200);
    expect(db.select().from(sessions).all()).toHaveLength(1);
  });

  it("verifies against a dummy hash carrying the production argon2 parameters", () => {
    // A stale constant would make "unknown email" cheaper than "wrong password" again.
    const params = /\$argon2id\$v=19\$m=(\d+),t=(\d+),/.exec(ABSENT_USER_HASH);
    expect(params).not.toBeNull();
    expect(Number(params![1])).toBe(ARGON2_PARAMS.memoryCost);
    expect(Number(params![2])).toBe(ARGON2_PARAMS.timeCost);
  });

  it("blocks per IP once the IP limit is reached regardless of the email", async () => {
    const { app } = makeTestApp(db);
    for (let i = 0; i < 20; i++) {
      await post(app, "/api/auth/login", { email: `probe${i}@example.test`, password: "bad" });
    }
    const blocked = await post(app, "/api/auth/login", { email: "fresh@example.test", password: "bad" });
    expect(blocked.status).toBe(429);
    // 21 argon2id verifications at production cost.
  }, 30_000);
});

describe("GET /api/me and logout", () => {
  it("401s without a session, returns the user with one, and 401s again after logout", async () => {
    const { app } = makeTestApp(db);
    const anonymous = await get(app, "/api/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });

    const login = await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD });
    const cookie = cookieFrom(login);

    const me = await get(app, "/api/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "owner@example.test" });

    const out = await post(app, "/api/auth/logout", {}, cookie);
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(db.select().from(sessions).all()).toHaveLength(0);

    const after = await get(app, "/api/me", cookie);
    expect(after.status).toBe(401);
  });

  it("answers 204 without a session cookie", async () => {
    const { app } = makeTestApp(db);
    expect((await post(app, "/api/auth/logout", {})).status).toBe(204);
  });

  it("refuses a logout carrying a cookie but a foreign Origin", async () => {
    const { app } = makeTestApp(db);
    const cookie = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));
    const res = await post(app, "/api/auth/logout", {}, cookie, "http://evil.example.test");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_check_failed" });
    // The session survives a rejected request.
    expect(db.select().from(sessions).all()).toHaveLength(1);
  });
});

describe("POST /api/me/password", () => {
  it("changes the password, revokes every old session and issues a new one", async () => {
    const { app } = makeTestApp(db);
    const first = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));
    const second = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));

    const changed = await post(
      app,
      "/api/me/password",
      { currentPassword: PASSWORD, newPassword: "a much longer secret" },
      second,
    );
    expect(changed.status).toBe(200);
    const fresh = cookieFrom(changed);
    expect(fresh).not.toBe(second);

    expect((await get(app, "/api/me", first)).status).toBe(401);
    expect((await get(app, "/api/me", second)).status).toBe(401);
    expect((await get(app, "/api/me", fresh)).status).toBe(200);

    const relogin = await post(app, "/api/auth/login", {
      email: "owner@example.test",
      password: "a much longer secret",
    });
    expect(relogin.status).toBe(200);
  });

  it("rejects a wrong current password and a too-short new one", async () => {
    const { app } = makeTestApp(db);
    const cookie = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));
    const wrong = await post(
      app,
      "/api/me/password",
      { currentPassword: "nope", newPassword: "long enough here" },
      cookie,
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "invalid_credentials" });
    const short = await post(app, "/api/me/password", { currentPassword: PASSWORD, newPassword: "short" }, cookie);
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "password_too_short" });
  });

  it("refuses an over-long current password before spending a KDF slot", async () => {
    const { app } = makeTestApp(db);
    const cookie = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));
    const res = await post(
      app,
      "/api/me/password",
      { currentPassword: "x".repeat(MAX_PASSWORD_LENGTH + 1), newPassword: "long enough here" },
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "password_too_long" });
  });

  it("rate-limits repeated wrong current passwords per user", async () => {
    const { app } = makeTestApp(db);
    const cookie = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));
    const attempt = (currentPassword: string) =>
      post(app, "/api/me/password", { currentPassword, newPassword: "long enough here" }, cookie);
    for (let i = 0; i < 5; i++) expect((await attempt("wrong wrong wrong")).status).toBe(401);
    const blocked = await attempt(PASSWORD);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_requests" });
  });

  it("401s for an anonymous caller without touching the stored hash", async () => {
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/me/password", { currentPassword: PASSWORD, newPassword: "long enough here" });
    expect(res.status).toBe(401);
    expect((await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD })).status).toBe(200);
  });
});

describe("csrfGuard covers project routes", () => {
  it("rejects a foreign Origin before the authorization scope runs", async () => {
    const { app } = makeTestApp(db, (a) => a.post("/api/projects/:id/thing", (c) => c.json({ ok: true })));
    const owner = await seedUserWithPassword(db, "pm@example.test", PASSWORD);
    const projectId = seedProject(db, owner);
    const cookie = cookieFrom(await post(app, "/api/auth/login", { email: "pm@example.test", password: PASSWORD }));
    const res = await post(app, `/api/projects/${projectId}/thing`, {}, cookie, "http://evil.example.test");
    // 403 csrf, not the 500 the fail-closed guard would produce for the unguarded handler.
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_check_failed" });
  });
});
