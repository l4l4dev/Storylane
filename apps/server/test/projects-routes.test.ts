import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestApp, makeTestDb, seedStory, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { activityLogs, projectStates, projects, stories } from "../src/db/schema";
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

  it("404s a reorder naming a state id from another project", async () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const theirs = createProject(db, owner, { name: "Theirs" });
    const mineStates = (await (await app.request(`${ORIGIN}/api/projects/${mine.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
    }>;
    const foreign = ((await (await app.request(`${ORIGIN}/api/projects/${theirs.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
    }>)[0]!;
    const res = await app.request(`${ORIGIN}/api/projects/${mine.id}/states/reorder`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ orderedIds: [...mineStates.slice(1).map((s) => s.id), foreign.id] }),
    });
    expect(res.status).toBe(404);
  });
});

function addMember(dbHandle: Db, projectId: string, actor: Actor, role: "member" | "viewer") {
  dbHandle.$client.run("insert into project_members (project_id, user_id, role, joined_at) values (?,?,?,?)", [
    projectId,
    (actor as { userId: string }).userId,
    role,
    Date.now(),
  ]);
}

describe("body validation runs after authorization, not before", () => {
  it("401s an invalid POST /states body for an anonymous caller", async () => {
    const project = createProject(db, owner, { name: "P" });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("403s an invalid POST /states body for a viewer", async () => {
    const project = createProject(db, owner, { name: "P" });
    addMember(db, project.id, viewer, "viewer");
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(viewer),
      body: JSON.stringify({ name: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it("409s a member's write on an archived project before the 403 a viewer would get", async () => {
    const project = createProject(db, owner, { name: "P" });
    addMember(db, project.id, viewer, "viewer");
    await app.request(`${ORIGIN}/api/projects/${project.id}/archive`, { method: "POST", headers: jsonAs(owner), body: "{}" });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(viewer),
      body: JSON.stringify({ name: "Nope", category: "in_progress" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
  });
});

describe("PATCH /api/projects/:id validation", () => {
  it("400s a non-string name instead of 500ing", async () => {
    const project = createProject(db, owner, { name: "P" });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("400s an invalid pointScale instead of hitting the DB trigger", async () => {
    const project = createProject(db, owner, { name: "P" });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: jsonAs(owner),
      body: JSON.stringify({ pointScale: "bogus" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH .../states/:stateId validation", () => {
  it("400s an empty name instead of 500ing", async () => {
    const project = createProject(db, owner, { name: "P" });
    const states = (await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
    }>;
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states/${states[0]!.id}`, {
      method: "PATCH",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("state 409 passthroughs at the HTTP boundary", () => {
  it("state_category_immutable via PATCH", async () => {
    const project = createProject(db, owner, { name: "P" });
    const states = (await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
      name: string;
      category: string;
    }>;
    const target = states.find((s) => s.name === "Unstarted")!;
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states/${target.id}`, {
      method: "PATCH",
      headers: jsonAs(owner),
      body: JSON.stringify({ category: "in_progress" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "state_category_immutable" });
  });

  it("state_last_of_category via DELETE", async () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const states = (await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
      category: string;
    }>;
    const done = states.find((s) => s.category === "done")!;
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states/${done.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "state_last_of_category" });
  });

  it("state_in_use via DELETE", async () => {
    const project = createProject(db, owner, { name: "P" });
    const states = (await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
      category: string;
    }>;
    const inProgress = states.find((s) => s.category === "in_progress")!;
    seedStory(db, project.id, { stateId: inProgress.id });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states/${inProgress.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "state_in_use" });
  });

  it("404s a cross-project stateId on DELETE", async () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const theirs = createProject(db, owner, { name: "Theirs" });
    const foreign = ((await (await app.request(`${ORIGIN}/api/projects/${theirs.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
    }>)[0]!;
    const res = await app.request(`${ORIGIN}/api/projects/${mine.id}/states/${foreign.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(res.status).toBe(404);
  });
});

describe("archived projects still allow delete", () => {
  it("lets the owner delete an archived project", async () => {
    const project = createProject(db, owner, { name: "P" });
    await app.request(`${ORIGIN}/api/projects/${project.id}/archive`, { method: "POST", headers: jsonAs(owner), body: "{}" });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}`, { method: "DELETE", headers: jsonAs(owner) });
    expect(res.status).toBe(204);
  });
});

describe("DELETE /api/projects/:id cascades", () => {
  it("removes the project's states, stories and activity rows", async () => {
    const project = createProject(db, owner, { name: "P" });
    const states = (await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json()) as Array<{
      id: string;
    }>;
    seedStory(db, project.id, { stateId: states[0]!.id });

    const res = await app.request(`${ORIGIN}/api/projects/${project.id}`, { method: "DELETE", headers: jsonAs(owner) });
    expect(res.status).toBe(204);

    expect(db.select().from(projects).where(eq(projects.id, project.id)).all()).toEqual([]);
    expect(db.select().from(projectStates).where(eq(projectStates.projectId, project.id)).all()).toEqual([]);
    expect(db.select().from(stories).where(eq(stories.projectId, project.id)).all()).toEqual([]);
    expect(db.select().from(activityLogs).where(eq(activityLogs.projectId, project.id)).all()).toEqual([]);
  });
});
