import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let viewer: Actor;
let app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> };
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor: Actor) => ({ ...as(actor), "content-type": "application/json", origin: ORIGIN });

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  viewer = seedUser(db, "viewer@example.test");
  app = makeTestApp(db).app;
});

describe("POST /api/projects", () => {
  it("creates a project owned by the caller with seeded states", async () => {
    const res = await app.request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Storylane" }),
    });
    expect(res.status).toBe(201);
    const project = (await res.json()) as { id: string; role: string };
    expect(project.role).toBe("owner");
    const states = await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json();
    expect((states as unknown[]).length).toBe(6);
  });

  it("401s for an anonymous caller and 400s on an empty name", async () => {
    const anon = await app.request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name: "x" }),
    });
    expect(anon.status).toBe(401);
    const empty = await app.request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "   " }),
    });
    expect(empty.status).toBe(400);
  });
});

describe("GET /api/projects", () => {
  it("lists only the caller's projects, archived ones last", async () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const archived = createProject(db, owner, { name: "Old" });
    createProject(db, viewer, { name: "Theirs" });
    await app.request(`${ORIGIN}/api/projects/${archived.id}/archive`, { method: "POST", headers: jsonAs(owner), body: "{}" });

    const res = await app.request(`${ORIGIN}/api/projects`, { headers: as(owner) });
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["Mine", "Old"]);
    expect(rows[0]!.id).toBe(mine.id);
  });
});

describe("archive and unarchive", () => {
  it("closes writes with 409 while archived and reopens them after unarchive", async () => {
    const project = createProject(db, owner, { name: "P" });
    await app.request(`${ORIGIN}/api/projects/${project.id}/archive`, { method: "POST", headers: jsonAs(owner), body: "{}" });

    const read = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) });
    expect(read.status).toBe(200);

    const write = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Blocked", category: "in_progress" }),
    });
    expect(write.status).toBe(409);
    expect(await write.json()).toEqual({ error: "project_archived" });

    const reopen = await app.request(`${ORIGIN}/api/projects/${project.id}/unarchive`, {
      method: "POST",
      headers: jsonAs(owner),
      body: "{}",
    });
    expect(reopen.status).toBe(200);
    const writeAgain = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Blocked", category: "in_progress" }),
    });
    expect(writeAgain.status).toBe(201);
  });
});

describe("state routes", () => {
  it("lets a member write states and a viewer only read them", async () => {
    const project = createProject(db, owner, { name: "P" });
    db.$client.run("insert into project_members (project_id, user_id, role, joined_at) values (?,?,?,?)", [
      project.id,
      (viewer as { userId: string }).userId,
      "viewer",
      Date.now(),
    ]);
    const read = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(viewer) });
    expect(read.status).toBe(200);
    const write = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(viewer),
      body: JSON.stringify({ name: "Nope", category: "in_progress" }),
    });
    expect(write.status).toBe(403);
  });

  it("reorders through the route and answers with the new order", async () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const states = (await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json()) as Array<{ id: string }>;
    const reversed = [...states].reverse().map((s) => s.id);
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states/reorder`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ orderedIds: reversed }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ id: string }>).map((s) => s.id)).toEqual(reversed);
  });

  it("404s for a state id from another project", async () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const theirs = createProject(db, owner, { name: "Theirs" });
    const foreign = ((await (await app.request(`${ORIGIN}/api/projects/${theirs.id}/states`, { headers: as(owner) })).json()) as Array<{ id: string }>)[0]!;
    const res = await app.request(`${ORIGIN}/api/projects/${mine.id}/states/${foreign.id}`, {
      method: "PATCH",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Hijack" }),
    });
    expect(res.status).toBe(404);
  });
});
