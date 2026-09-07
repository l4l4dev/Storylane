import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestApp, makeTestDb, seedUser, seedUserWithPassword } from "./harness";
import { RESET_TTL_MS } from "../src/services/reset";
import { createRateLimiter } from "../src/auth/rate-limit";
import { resetTokens, sessions } from "../src/db/schema";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let admin: Actor;
let plainUser: Actor;
let target: Actor;
let app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> };
const ORIGIN = "http://127.0.0.1";
const PASSWORD = "correct horse battery";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor?: Actor) => ({
  ...(actor ? as(actor) : {}),
  "content-type": "application/json",
  origin: ORIGIN,
});
const userIdOf = (actor: Actor) => (actor as { userId: string }).userId;

const mint = (actor: Actor | undefined, userId: string) =>
  app.request(`${ORIGIN}/api/admin/users/${userId}/reset-link`, {
    method: "POST",
    headers: jsonAs(actor),
    body: "{}",
  });

beforeEach(async () => {
  db = makeTestDb();
  admin = seedUser(db, "admin@example.test", true);
  plainUser = seedUser(db, "plain@example.test");
  target = await seedUserWithPassword(db, "target@example.test", PASSWORD);
  app = makeTestApp(db).app;
});

describe("POST /api/admin/users/:userId/reset-link", () => {
  it("is admin-only: 401 anonymous, 403 non-admin, 200 admin", async () => {
    expect((await mint(undefined, userIdOf(target))).status).toBe(401);
    expect((await mint(plainUser, userIdOf(target))).status).toBe(403);
    const res = await mint(admin, userIdOf(target));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { token: string; expiresAt: number; path: string };
    expect(payload.path).toBe(`/reset/${payload.token}`);
    expect(payload.expiresAt).toBeLessThanOrEqual(Date.now() + RESET_TTL_MS);
    const rows = db.select().from(resetTokens).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(payload.token);
  });

  it("404s for an unknown user", async () => {
    expect((await mint(admin, "no-such-user")).status).toBe(404);
  });
});

describe("using a reset link", () => {
  const use = (token: string, password: string) =>
    app.request(`${ORIGIN}/api/auth/reset/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ password }),
    });

  it("previews the account, sets the password, revokes sessions and is single-use", async () => {
    // The target has a live session that must not survive the reset.
    const login = await app.request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "target@example.test", password: PASSWORD }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(db.select().from(sessions).all()).toHaveLength(1);

    const { token } = (await (await mint(admin, userIdOf(target))).json()) as { token: string };
    const preview = await app.request(`${ORIGIN}/api/auth/reset/${token}`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ email: "target@example.test" });

    const res = await use(token, "a whole new secret");
    expect(res.status).toBe(200);
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect((await app.request(`${ORIGIN}/api/me`, { headers: { cookie } })).status).toBe(401);

    const relogin = await app.request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "target@example.test", password: "a whole new secret" }),
    });
    expect(relogin.status).toBe(200);

    expect((await use(token, "yet another secret")).status).toBe(404);
    expect((await app.request(`${ORIGIN}/api/auth/reset/${token}`)).status).toBe(404);
  });

  it("refuses an expired token and a too-short password", async () => {
    const { token } = (await (await mint(admin, userIdOf(target))).json()) as { token: string };
    expect((await use(token, "short")).status).toBe(400);
    db.update(resetTokens).set({ expiresAt: Date.now() - 1 }).where(eq(resetTokens.userId, userIdOf(target))).run();
    expect((await use(token, "a whole new secret")).status).toBe(404);
  });

  it("sets Cache-Control: no-store on preview and reset responses", async () => {
    const { token } = (await (await mint(admin, userIdOf(target))).json()) as { token: string };
    const preview = await app.request(`${ORIGIN}/api/auth/reset/${token}`);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    const reset = await use(token, "a whole new secret");
    expect(reset.headers.get("cache-control")).toBe("no-store");
  });

  it("never writes the raw token into the request log", async () => {
    const { token } = (await (await mint(admin, userIdOf(target))).json()) as { token: string };
    const { app: logged, lines } = makeTestApp(db);
    await logged.request(`${ORIGIN}/api/auth/reset/${token}`);
    await logged.request(`${ORIGIN}/api/auth/reset/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ password: "a whole new secret" }),
    });
    for (const line of lines) expect(line).not.toContain(token);
    const paths = lines.map((l) => (JSON.parse(l) as { path: string }).path);
    expect(paths).toContain("/api/auth/reset/:token");
  });

  it("rate-limits preview/reset per IP and answers 429 past the limit", async () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000, now: () => now });
    const limited = makeTestApp(db, undefined, { resetLimiter: limiter }).app;
    const { token } = (await (await mint(admin, userIdOf(target))).json()) as { token: string };
    for (let i = 0; i < 20; i++) {
      const res = await limited.request(`${ORIGIN}/api/auth/reset/${token}`);
      expect(res.status).toBe(200);
    }
    const blocked = await limited.request(`${ORIGIN}/api/auth/reset/${token}`);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_requests" });
  });
});
