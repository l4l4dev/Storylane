import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttachmentStore } from "../src/attachments/store";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createLogger } from "../src/log";
import {
  makeTestApp,
  makeTestDb,
  seedAttachment,
  seedBlocker,
  seedComment,
  seedEpic,
  seedLabel,
  seedProject,
  seedReview,
  seedReviewType,
  seedStory,
  seedTask,
  seedUser,
} from "./harness";
import { ROUTE_ACTIONS } from "../src/authz/route-manifest";
import { ALL_ACTIONS, expected, ROLES, type Action, type Role } from "../src/authz/permissions";
import { withProject, type Actor } from "../src/db/tx";
import { projects } from "../src/db/schema";
import { matrixFixtures, type AuthorRole, type MatrixFixture } from "./matrix-fixtures";
import { mintInvite } from "../src/services/invites";

const db = makeTestDb();
const dataDir = mkdtempSync(join(tmpdir(), "sl-matrix-"));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
const store = createAttachmentStore(dataDir);
const { app } = makeTestApp(db, undefined, { dataDir });
const ownerA = seedUser(db, "o@example.test");
const memberA = seedUser(db, "m@example.test");
const viewerA = seedUser(db, "v@example.test");
const outsider = seedUser(db, "x@example.test");

function seedFullProject() {
  const id = seedProject(db, ownerA, [
    [memberA, "member"],
    [viewerA, "viewer"],
  ]);
  const seededInvite = withProject(db, ownerA, id, "member:invite", (tx) => mintInvite(tx, { role: "member" }));
  const storyId = seedStory(db, id);
  // labelId backs no epic, so DELETE .../labels/:labelId never sees a 409 label_backs_an_epic.
  const labelId = seedLabel(db, id, "matrix label");
  const epicId = seedEpic(db, id, "Matrix epic seed");
  const taskId = seedTask(db, id, storyId, "Matrix task seed");
  const blockerId = seedBlocker(db, id, storyId, ownerA, "Matrix blocker seed");
  const reviewTypeId = seedReviewType(db, id);
  const reviewId = seedReview(db, id, storyId, reviewTypeId);
  const authors = { viewer: viewerA, member: memberA, owner: ownerA };
  const commentIds = {} as Record<AuthorRole, string>;
  const attachmentIds = {} as Record<AuthorRole, string>;
  for (const [role, author] of Object.entries(authors) as [AuthorRole, Actor][]) {
    commentIds[role] = seedComment(db, id, storyId, author);
    attachmentIds[role] = seedAttachment(db, store, id, commentIds[role], author);
  }
  return {
    id,
    inviteId: seededInvite.invite.id,
    storyId,
    labelId,
    epicId,
    taskId,
    blockerId,
    reviewTypeId,
    reviewId,
    commentIds,
    attachmentIds,
  };
}

const seeded = seedFullProject();
const projectId = seeded.id;
const fixturesFor = (t: ReturnType<typeof seedFullProject>): Record<string, MatrixFixture> =>
  matrixFixtures({
    projectId: t.id,
    inviteId: t.inviteId,
    userId: (ownerA as { userId: string }).userId,
    memberUserId: (memberA as { userId: string }).userId,
    storyId: t.storyId,
    labelId: t.labelId,
    epicId: t.epicId,
    taskId: t.taskId,
    blockerId: t.blockerId,
    reviewTypeId: t.reviewTypeId,
    reviewId: t.reviewId,
    ownerUserId: (ownerA as { userId: string }).userId,
    commentIds: t.commentIds,
    attachmentIds: t.attachmentIds,
  });
const FIXTURES = fixturesFor(seeded);
const actors: Record<Role, Actor> = {
  anonymous: { kind: "anonymous" },
  "non-member": outsider,
  viewer: viewerA,
  member: memberA,
  owner: ownerA,
};

// Destructive rows mutate the shared seeded project (or its spare state), and the matrix
// iterates roles in a fixed order (anonymous, non-member, viewer, member, owner) — the owner
// row runs last, so an earlier role never sees a deleted project/state. Give each destructive
// key its own fresh project per role so the shared one stays live for the rest of the matrix.
const DESTRUCTIVE = new Set([
  "DELETE /api/projects/:id",
  "DELETE /api/projects/:id/memberships/:userId",
  "DELETE /api/projects/:id/memberships/me",
  "DELETE /api/projects/:id/stories/:storyId",
  "DELETE /api/projects/:id/stories/:storyId/owners/:userId",
  "DELETE /api/projects/:id/stories/:storyId/follow",
  "DELETE /api/projects/:id/stories/:storyId/followers/:userId",
  "DELETE /api/projects/:id/labels/:labelId",
  "DELETE /api/projects/:id/stories/:storyId/labels/:labelId",
  "DELETE /api/projects/:id/epics/:epicId",
  "DELETE /api/projects/:id/stories/:storyId/tasks/:taskId",
  "DELETE /api/projects/:id/stories/:storyId/blockers/:blockerId",
  "DELETE /api/projects/:id/stories/:storyId/comments/:commentId",
  "DELETE /api/projects/:id/attachments/:attachmentId",
  "DELETE /api/projects/:id/stories/:storyId/reviews/:reviewId",
  // The owner row hides ctx.reviewTypeId, which would otherwise make every later
  // review:write POST fixture (using the same type) answer 409 review_type_hidden.
  "PUT /api/projects/:id/review_types/:reviewTypeId",
  // POST creates a label/epic by name; run twice against the shared project (member then
  // owner rows both expecting 200) the second call would 409 on the name it already took.
  "POST /api/projects/:id/labels",
  "POST /api/projects/:id/epics",
  // Not a DELETE, but the owner row permanently demotes ctx.memberUserId to "viewer" in the
  // shared project — any later matrix row that relies on that actor still being "member"
  // (e.g. story:write) would otherwise see the wrong role.
  "PUT /api/projects/:id/memberships/:userId",
]);

// Only these exact middleware registrations (app.use(path, …) in app.ts) are exempt — an
// explicit allowlist, not a heuristic, so a real route registered with app.all(...) still
// needs a manifest entry even if its path happens to end in "/*".
const EXEMPT_MIDDLEWARE_PATHS = new Set(["/*", "/api/projects/:id/*", "/api/*"]);
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
        // Each destructive role gets its own project/state so an earlier role's delete
        // never leaves a later role authorizing against an already-gone row.
        const target = DESTRUCTIVE.has(key) ? seedFullProject() : seeded;
        const shared = DESTRUCTIVE.has(key) ? fixturesFor(target)[key] ?? {} : FIXTURES[key] ?? {};
        const fixture = shared.perRole?.[role] ?? shared;
        let url = path.replace(":id", target.id);
        for (const [name, value] of Object.entries(fixture.params ?? {})) url = url.replace(`:${name}`, value);
        expect(url).not.toContain("/:"); // a param with no fixture would make every row meaningless
        const headers: Record<string, string> =
          actor.kind === "anonymous" ? {} : { "x-test-actor": JSON.stringify(actor) };
        // csrfGuard rejects any unsafe request that is not application/json, so every non-GET
        // row must carry the header or the matrix would assert 403 instead of the real answer.
        if (method !== "GET") headers["content-type"] = "application/json";
        const raw = fixture.rawBody;
        if (raw) {
          Object.assign(headers, raw.headers, {
            "content-type": raw.contentType,
            "content-length": String(new TextEncoder().encode(raw.bytes).byteLength),
          });
        }
        const res = await app.request(url, {
          method,
          headers,
          ...(raw ? { body: raw.bytes } : fixture.body === undefined ? {} : { body: JSON.stringify(fixture.body) }),
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
    // application/json so csrfGuard (which runs first) lets the request reach failClosed.
    const res = await leaky.request(`/api/projects/${projectId}`, {
      method: "POST",
      headers: { ...asOwner, "content-type": "application/json" },
    });
    expect(res.status).toBe(500);
  });

  it("does not catch a non-project route under /api/projects", async () => {
    // GET /api/projects is now a real route (the caller's own list), so this probes the same
    // bare path with a method nothing else registers, to keep testing that failClosed's
    // trailing wildcard leaves the path with no :id segment alone.
    const { app: list } = makeTestApp(db, (a) => a.put("/api/projects", (c) => c.json([])));
    const res = await list.request("/api/projects", {
      method: "PUT",
      headers: { ...asOwner, "content-type": "application/json" },
    });
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

describe("self and admin rules reject anonymous callers, admin rules also reject non-admins", () => {
  // Logout is the one exception: it is idempotent by design, so a caller with no session gets
  // 204 and a cleared cookie rather than an error.
  const IDEMPOTENT_WITHOUT_SESSION = new Set(["POST /api/auth/logout"]);
  const urlFor = (path: string, fixture: MatrixFixture) => {
    let url = path.replace(":id", projectId);
    for (const [name, value] of Object.entries(fixture.params ?? {})) url = url.replace(`:${name}`, value);
    expect(url).not.toContain("/:"); // a param with no fixture would make this row meaningless
    return url;
  };

  for (const [key, rule] of Object.entries(ROUTE_ACTIONS)) {
    if (rule !== "self" && rule !== "admin") continue;
    if (IDEMPOTENT_WITHOUT_SESSION.has(key)) continue;
    const [method, path] = key.split(" ") as [string, string];
    it(`${key} as anonymous → 401`, async () => {
      const fixture = FIXTURES[key] ?? {};
      const res = await app.request(urlFor(path, fixture), {
        method,
        ...(method === "GET" ? {} : { headers: { "content-type": "application/json" } }),
        ...(fixture.body === undefined ? {} : { body: JSON.stringify(fixture.body) }),
      });
      expect(res.status).toBe(401);
    });
    if (rule !== "admin") continue;
    // `outsider` is a seeded, signed-in user with no admin flag and no relation to the seeded
    // project — the generic "signed in, not an admin" actor for every current and future
    // `admin`-rule route, so a route added without requireAdmin fails this sweep instead of
    // only its own hand-written test.
    it(`${key} as a signed-in non-admin → 403`, async () => {
      const fixture = FIXTURES[key] ?? {};
      const res = await app.request(urlFor(path, fixture), {
        method,
        headers: {
          "x-test-actor": JSON.stringify(outsider),
          ...(method === "GET" ? {} : { "content-type": "application/json" }),
        },
        ...(fixture.body === undefined ? {} : { body: JSON.stringify(fixture.body) }),
      });
      expect(res.status).toBe(403);
    });
  }
});
