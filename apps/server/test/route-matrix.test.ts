import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createLogger } from "../src/log";
import { makeTestApp, makeTestDb, seedProject, seedUser } from "./harness";
import { ROUTE_ACTIONS } from "../src/authz/route-manifest";
import { ALL_ACTIONS, expected, ROLES, type Action, type Role } from "../src/authz/permissions";
import { withProject, type Actor } from "../src/db/tx";
import { projects } from "../src/db/schema";
import { matrixFixtures } from "./matrix-fixtures";

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
const FIXTURES = matrixFixtures({ projectId });
const actors: Record<Role, Actor> = {
  anonymous: { kind: "anonymous" },
  "non-member": outsider,
  viewer: viewerA,
  member: memberA,
  owner: ownerA,
};

// Only these exact middleware registrations (app.use(path, …) in app.ts) are exempt — an
// explicit allowlist, not a heuristic, so a real route registered with app.all(...) still
// needs a manifest entry even if its path happens to end in "/*".
const EXEMPT_MIDDLEWARE_PATHS = new Set(["/*", "/api/projects/:id/*"]);
const registered = app.routes
  .filter((r) => !(r.method === "ALL" && EXEMPT_MIDDLEWARE_PATHS.has(r.path)))
  .map((r) => `${r.method} ${r.path}`);

const isAction = (rule: string): rule is Action => (ALL_ACTIONS as string[]).includes(rule);

describe("route manifest", () => {
  it("covers every registered route", () => {
    const missing = registered.filter((k) => !(k in ROUTE_ACTIONS));
    expect(missing).toEqual([]);
  });
  it("has no stale entries", () => {
    const stale = Object.keys(ROUTE_ACTIONS).filter((k) => !registered.includes(k));
    expect(stale).toEqual([]);
  });

  it("gives every project-scoped route an Action rule", () => {
    // The matrix loop below skips non-Action rules ("public"/"self"/"admin"/"setup"), so such a
    // rule on a project route would silently escape both the shape check and the five-actor sweep.
    const escaped = Object.entries(ROUTE_ACTIONS)
      .filter(([key, rule]) => key.split(" ")[1]!.startsWith("/api/projects/") && !isAction(rule))
      .map(([key, rule]) => `${key} → ${rule}`);
    expect(escaped).toEqual([]);
  });

  it("has no fixture for a route that does not exist", () => {
    // A typo'd fixture key would silently drop the params/body it was meant to supply.
    const unknown = Object.keys(FIXTURES).filter((k) => !(k in ROUTE_ACTIONS));
    expect(unknown).toEqual([]);
  });
});

describe("permission matrix over project routes", () => {
  for (const [key, rule] of Object.entries(ROUTE_ACTIONS)) {
    if (!isAction(rule)) continue;
    const [method, path] = key.split(" ") as [string, string];
    it(`${key} is addressed by project id`, () => {
      // A project-scoped route declared with another param name would silently skip the matrix.
      expect(path).toMatch(/^\/api\/projects\/:id(\/|$)/);
    });
    for (const role of ROLES) {
      it(`${key} as ${role} → ${expected(rule, role)}`, async () => {
        const actor = actors[role];
        const fixture = FIXTURES[key] ?? {};
        let url = path.replace(":id", projectId);
        for (const [name, value] of Object.entries(fixture.params ?? {})) url = url.replace(`:${name}`, value);
        expect(url).not.toContain("/:"); // a param with no fixture would make every row meaningless
        const headers: Record<string, string> =
          actor.kind === "anonymous" ? {} : { "x-test-actor": JSON.stringify(actor) };
        if (fixture.body !== undefined) headers["content-type"] = "application/json";
        const res = await app.request(url, {
          method,
          headers,
          ...(fixture.body === undefined ? {} : { body: JSON.stringify(fixture.body) }),
        });
        if (fixture.stream) await res.body?.cancel();
        const want = expected(rule, role);
        if (want === 200) expect(res.status).toBeLessThan(300);
        else expect(res.status).toBe(want);
      });
    }
  }
});

describe("fail-closed middleware", () => {
  const asOwner = { "x-test-actor": JSON.stringify(ownerA) };

  it("turns an unauthorized handler into 500", async () => {
    const { app: leaky } = makeTestApp(db, (a) => a.get("/api/projects/:id/leak", (c) => c.json({ ok: true })));
    const res = await leaky.request(`/api/projects/${projectId}/leak`, { headers: asOwner });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "authorization_missing" });
  });

  it("turns a handler that reads raw db without withProject into 500", async () => {
    const { app: leaky } = makeTestApp(db, (a) =>
      a.get("/api/projects/:id/raw", (c) =>
        c.json(db.select().from(projects).where(eq(projects.id, c.req.param("id"))).get() ?? null),
      ),
    );
    const res = await leaky.request(`/api/projects/${projectId}/raw`, { headers: asOwner });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "authorization_missing" });
  });

  it("lets a handler that goes through withProject answer 200", async () => {
    const { app: good } = makeTestApp(db, (a) =>
      a.get("/api/projects/:id/ok", (c) =>
        c.json(withProject(db, ownerA, c.req.param("id"), "project:read", (tx) => ({ id: tx.projectId }))),
      ),
    );
    const res = await good.request(`/api/projects/${projectId}/ok`, { headers: asOwner });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: projectId });
  });

  it("covers the single-segment /api/projects/:id path, not only deeper ones", async () => {
    // The trailing wildcard must match zero segments, or GET /api/projects/:id itself would
    // run unguarded. Built through makeTestApp/createApp (production registration order),
    // using POST so the leak sits at the same path as the real (guarded) GET route.
    const { app: leaky } = makeTestApp(db, (a) => a.post("/api/projects/:id", (c) => c.json({ leak: true })));
    const res = await leaky.request(`/api/projects/${projectId}`, { method: "POST", headers: asOwner });
    expect(res.status).toBe(500);
  });

  it("does not catch a non-project route under /api/projects", async () => {
    const { app: list } = makeTestApp(db, (a) => a.get("/api/projects", (c) => c.json([])));
    const res = await list.request("/api/projects", { headers: asOwner });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
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

describe("project-scoped fail-closed", () => {
  const asOwner = { "x-test-actor": JSON.stringify(ownerA) };

  it("turns a handler that authorized another project into 500", async () => {
    const other = seedProject(db, ownerA);
    const { app: crossed } = makeTestApp(db, (a) =>
      a.get("/api/projects/:id/crossed", (c) =>
        // Authorizes `other`, answers for c.req.param("id") — the phase-0 counter accepted this.
        c.json(withProject(db, ownerA, other, "project:read", (tx) => ({ id: tx.projectId }))),
      ),
    );
    const res = await crossed.request(`/api/projects/${projectId}/crossed`, { headers: asOwner });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "authorization_missing" });
  });

  it("ignores a route pattern that names another segment :id", async () => {
    // The guard matches /api/projects/:id/*, but this route's own pattern calls segment 3 :pid
    // and segment 5 :id — reading c.req.param("id") after next() would check the wrong project.
    const other = seedProject(db, ownerA);
    const { app: renamed } = makeTestApp(db, (a) =>
      a.get("/api/projects/:pid/link/:id", (c) =>
        c.json({
          authorized: withProject(db, ownerA, c.req.param("id"), "project:read", (tx) => tx.projectId),
          served: c.req.param("pid"),
        }),
      ),
    );
    const res = await renamed.request(`/api/projects/${other}/link/${projectId}`, { headers: asOwner });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "authorization_missing" });
  });

  it("accepts a handler that authorized the requested project", async () => {
    const { app: good } = makeTestApp(db, (a) =>
      a.get("/api/projects/:id/same", (c) =>
        c.json(withProject(db, ownerA, c.req.param("id"), "project:read", (tx) => ({ id: tx.projectId }))),
      ),
    );
    const res = await good.request(`/api/projects/${projectId}/same`, { headers: asOwner });
    expect(res.status).toBe(200);
  });
});
