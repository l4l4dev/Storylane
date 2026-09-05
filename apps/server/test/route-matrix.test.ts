import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createLogger } from "../src/log";
import { makeTestApp, makeTestDb, seedProject, seedUser } from "./harness";
import { ROUTE_ACTIONS } from "../src/authz/route-manifest";
import { expected, ROLES, type Action, type Role } from "../src/authz/permissions";
import type { Actor } from "../src/db/tx";

const db = makeTestDb();
const { app } = makeTestApp(db);
const ownerA = seedUser(db, "o@example.test");
const memberA = seedUser(db, "m@example.test");
const viewerA = seedUser(db, "v@example.test");
const outsider = seedUser(db, "x@example.test");
const projectId = seedProject(db, ownerA, [
  [memberA, "member"],
  [viewerA, "viewer"],
]);
const actors: Record<Role, Actor> = {
  anonymous: { kind: "anonymous" },
  "non-member": outsider,
  viewer: viewerA,
  member: memberA,
  owner: ownerA,
};

const registered = app.routes
  .filter((r) => r.method !== "ALL" && !r.path.endsWith("/*"))
  .map((r) => `${r.method} ${r.path}`);

describe("route manifest", () => {
  it("covers every registered route", () => {
    const missing = registered.filter((k) => !(k in ROUTE_ACTIONS));
    expect(missing).toEqual([]);
  });
  it("has no stale entries", () => {
    const stale = Object.keys(ROUTE_ACTIONS).filter((k) => !registered.includes(k));
    expect(stale).toEqual([]);
  });
});

describe("permission matrix over project routes", () => {
  for (const [key, rule] of Object.entries(ROUTE_ACTIONS)) {
    if (!key.includes("/api/projects/:id")) continue;
    const [method, path] = key.split(" ") as [string, string];
    for (const role of ROLES) {
      it(`${key} as ${role} → ${expected(rule as Action, role)}`, async () => {
        const actor = actors[role];
        const res = await app.request(path.replace(":id", projectId), {
          method,
          headers: actor.kind === "anonymous" ? {} : { "x-test-actor": JSON.stringify(actor) },
        });
        const want = expected(rule as Action, role);
        if (want === 200) expect(res.status).toBeLessThan(300);
        else expect(res.status).toBe(want);
      });
    }
  }
});

describe("fail-closed middleware", () => {
  it("turns an unauthorized handler into 500", async () => {
    const { app: leaky } = makeTestApp(db, (a) => a.get("/api/projects/:id/leak", (c) => c.json({ ok: true })));
    const res = await leaky.request(`/api/projects/${projectId}/leak`, {
      headers: { "x-test-actor": JSON.stringify(ownerA) },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "authorization_missing" });
  });
});

describe("x-test-actor header", () => {
  it("is ignored unless the app was built with testActorHeader", async () => {
    const prod = createApp({
      config: loadConfig({}),
      log: createLogger(() => {}),
      health: () => true,
      db,
      testActorHeader: false,
    });
    const res = await prod.request(`/api/projects/${projectId}`, {
      headers: { "x-test-actor": JSON.stringify(ownerA) },
    });
    expect(res.status).toBe(401);
  });
});
