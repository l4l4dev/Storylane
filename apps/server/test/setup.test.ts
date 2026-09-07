import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestApp, makeTestDb, seedProject, seedUser } from "./harness";
import { createLogger } from "../src/log";
import { ensureSetupToken, hasAnyUser, SETUP_TOKEN_TTL_MS } from "../src/setup/setup-token";
import { instanceMeta, users } from "../src/db/schema";
import { SESSION_COOKIE } from "../src/auth/sessions";
import type { Db } from "../src/db/client";

let db: Db;
const ORIGIN = "http://127.0.0.1";

const post = (
  app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> },
  path: string,
  body: unknown,
) =>
  app.request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db = makeTestDb();
});

describe("ensureSetupToken", () => {
  it("mints and logs exactly one token while no user exists", () => {
    const lines: string[] = [];
    const token = ensureSetupToken(db, createLogger((l) => lines.push(l)));
    expect(token).toBeString();
    const tokenLines = lines.filter((l) => JSON.parse(l).msg === "setup token");
    expect(tokenLines).toHaveLength(1);
    expect(JSON.parse(tokenLines[0]!).token).toBe(token);
    expect(db.select().from(instanceMeta).all().map((r) => r.key).sort()).toEqual([
      "setup_token_expires_at",
      "setup_token_hash",
    ]);
    // Only the hash is stored.
    expect(JSON.stringify(db.select().from(instanceMeta).all())).not.toContain(token!);
  });

  it("mints a different token on every boot while no admin exists", () => {
    const silent = createLogger(() => {});
    expect(ensureSetupToken(db, silent)).not.toBe(ensureSetupToken(db, silent));
  });

  it("logs nothing and clears the stored token once a user exists", () => {
    const lines: string[] = [];
    ensureSetupToken(db, createLogger(() => {}));
    seedUser(db, "admin@example.test", true);
    expect(ensureSetupToken(db, createLogger((l) => lines.push(l)))).toBeNull();
    expect(lines.filter((l) => JSON.parse(l).msg === "setup token")).toHaveLength(0);
    expect(db.select().from(instanceMeta).all()).toHaveLength(0);
    expect(hasAnyUser(db)).toBe(true);
  });
});

describe("setup gate", () => {
  it("answers 409 setup_required on a project route while no user exists", async () => {
    const { app } = makeTestApp(db);
    const res = await app.request(`${ORIGIN}/api/projects/whatever`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "setup_required" });
  });

  it("does not gate /healthz or /api/setup", async () => {
    const { app } = makeTestApp(db);
    ensureSetupToken(db, createLogger(() => {}));
    expect((await app.request(`${ORIGIN}/healthz`)).status).toBe(200);
    expect((await app.request(`${ORIGIN}/api/setup`)).status).toBe(200);
  });

  it("stops gating once a user exists", async () => {
    const owner = seedUser(db, "owner@example.test");
    const projectId = seedProject(db, owner);
    const { app } = makeTestApp(db);
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}`, {
      headers: { "x-test-actor": JSON.stringify(owner) },
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/setup", () => {
  const body = (token: string) => ({
    token,
    email: "admin@example.test",
    displayName: "Admin",
    password: "correct horse battery",
  });

  it("creates the admin, logs them in and closes /api/setup", async () => {
    const token = ensureSetupToken(db, createLogger(() => {}))!;
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/setup", body(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    const row = db.select().from(users).all()[0]!;
    expect(row.email).toBe("admin@example.test");
    expect(row.isAdmin).toBe(true);
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect((await app.request(`${ORIGIN}/api/setup`)).status).toBe(404);
    expect((await post(app, "/api/setup", body(token))).status).toBe(404);
  });

  it("rejects a wrong token and an expired one with the same message", async () => {
    ensureSetupToken(db, createLogger(() => {}));
    const { app } = makeTestApp(db);
    const wrong = await post(app, "/api/setup", body("not-the-token"));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "setup_token_invalid" });

    db.update(instanceMeta)
      .set({ value: String(Date.now() - SETUP_TOKEN_TTL_MS - 1), updatedAt: Date.now() })
      .where(eq(instanceMeta.key, "setup_token_expires_at"))
      .run();
    const expired = await post(app, "/api/setup", body("anything"));
    expect(expired.status).toBe(403);
    expect(await expired.json()).toEqual({ error: "setup_token_invalid" });
    expect(db.select().from(users).all()).toHaveLength(0);
  });

  it("creates exactly one admin under two concurrent submissions", async () => {
    const token = ensureSetupToken(db, createLogger(() => {}))!;
    const { app } = makeTestApp(db);
    const [a, b] = await Promise.all([post(app, "/api/setup", body(token)), post(app, "/api/setup", body(token))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]!).toBe(200);
    expect([403, 404]).toContain(statuses[1]!);
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  it("rejects a short password before touching the database", async () => {
    const token = ensureSetupToken(db, createLogger(() => {}))!;
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/setup", { ...body(token), password: "short" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "password_too_short" });
    expect(db.select().from(users).all()).toHaveLength(0);
  });
});
