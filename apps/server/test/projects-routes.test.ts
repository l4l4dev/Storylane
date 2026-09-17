import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestApp, makeTestDb, seedMembership, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { activities, projects } from "../src/db/schema";
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
  it("creates a project owned by the caller", async () => {
    const res = await app.request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Storylane" }),
    });
    expect(res.status).toBe(201);
    const project = (await res.json()) as { id: string; role: string };
    expect(project.role).toBe("owner");
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

    const read = await app.request(`${ORIGIN}/api/projects/${project.id}`, { headers: as(owner) });
    expect(read.status).toBe(200);

    const write = await app.request(`${ORIGIN}/api/projects/${project.id}`, {
      method: "PUT",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Blocked" }),
    });
    expect(write.status).toBe(409);
    expect(await write.json()).toEqual({ error: "project_archived" });

    const reopen = await app.request(`${ORIGIN}/api/projects/${project.id}/unarchive`, {
      method: "POST",
      headers: jsonAs(owner),
      body: "{}",
    });
    expect(reopen.status).toBe(200);
    const writeAgain = await app.request(`${ORIGIN}/api/projects/${project.id}`, {
      method: "PUT",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Reopened" }),
    });
    expect(writeAgain.status).toBe(200);
  });
});

describe("PUT /api/projects/:id validation", () => {
  it("400s a non-string name instead of 500ing", async () => {
    const project = createProject(db, owner, { name: "P" });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}`, {
      method: "PUT",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("400s an invalid point_scale instead of hitting the DB trigger", async () => {
    const project = createProject(db, owner, { name: "P" });
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}`, {
      method: "PUT",
      headers: jsonAs(owner),
      body: JSON.stringify({ point_scale: "bogus" }),
    });
    expect(res.status).toBe(400);
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
  it("removes the project's activity rows", async () => {
    const project = createProject(db, owner, { name: "P" });

    const res = await app.request(`${ORIGIN}/api/projects/${project.id}`, { method: "DELETE", headers: jsonAs(owner) });
    expect(res.status).toBe(204);

    expect(db.select().from(projects).where(eq(projects.id, project.id)).all()).toEqual([]);
    expect(db.select().from(activities).where(eq(activities.projectId, project.id)).all()).toEqual([]);
  });
});

describe("POST /api/projects/:id/review_types authorization precedence", () => {
  it("answers 403 (not 400) for a member's POST with an empty name — authorization runs before body validation", async () => {
    const project = createProject(db, owner, { name: "P" });
    const member = seedUser(db, "member@example.test");
    seedMembership(db, project.id, member, "member");
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/review_types`, {
      method: "POST",
      headers: jsonAs(member),
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(403);
  });
});

async function putJson(path: string, actor: Actor, payload: string | Record<string, unknown>) {
  const res = await app.request(`${ORIGIN}${path}`, {
    method: path.endsWith("review_types") ? "POST" : "PUT",
    headers: jsonAs(actor),
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("PUT /api/projects/:id settings bounds", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ iteration_length: 1.5 }, "iteration_length_invalid"],
    [{ week_start_day: 0.5 }, "week_start_day_invalid"],
    [{ velocity_averaged_over: 2.5 }, "velocity_averaged_over_invalid"],
    [{ number_of_done_iterations_to_show: 3.7 }, "number_of_done_iterations_to_show_invalid"],
    [{ initial_velocity: 2.2 }, "initial_velocity_invalid"],
    [{ start_date: "hello" }, "start_date_invalid"],
    [{ start_date: "2026-13-45" }, "start_date_invalid"],
    [{ start_date: "2026-02-30" }, "start_date_invalid"],
  ];
  for (const [patch, code] of cases) {
    it(`answers 400 ${code} for ${JSON.stringify(patch)} and stores nothing`, async () => {
      const project = createProject(db, owner, { name: "P" });
      const before = db.select().from(projects).where(eq(projects.id, project.id)).get();
      expect(await putJson(`/api/projects/${project.id}`, owner, patch)).toEqual({ status: 400, body: { error: code } });
      expect(db.select().from(projects).where(eq(projects.id, project.id)).get()).toEqual(before);
    });
  }

  it("answers 400 invalid_body for malformed JSON", async () => {
    const project = createProject(db, owner, { name: "P" });
    expect(await putJson(`/api/projects/${project.id}`, owner, "{\"name\":")).toEqual({
      status: 400,
      body: { error: "invalid_body" },
    });
  });
});

describe("review type names are trimmed", () => {
  it("stores a trimmed name on create and rename, and refuses a blank one", async () => {
    const project = createProject(db, owner, { name: "P" });
    const created = await putJson(`/api/projects/${project.id}/review_types`, owner, { name: "  Legal sign-off  " });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Legal sign-off");
    expect(await putJson(`/api/projects/${project.id}/review_types`, owner, { name: "   " })).toEqual({
      status: 400,
      body: { error: "name_required" },
    });
    const renamed = await putJson(`/api/projects/${project.id}/review_types/${created.body.id as string}`, owner, {
      name: " Legal ",
    });
    expect(renamed.body.name).toBe("Legal");
  });
});
