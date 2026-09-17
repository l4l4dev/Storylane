import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { activities, storyLabels } from "../src/db/schema";
import { makeTestApp, makeTestDb, seedLabel, seedProject, seedStory, seedUser } from "./harness";

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = seedProject(db, owner);
  const { app } = makeTestApp(db);
  const headers = { "x-test-actor": JSON.stringify(owner), "content-type": "application/json" };
  return { db, owner, projectId, app, headers };
}

describe("story routes", () => {
  it("creates, reads, lists, updates and deletes a story", async () => {
    const { projectId, app, headers } = setup();

    const created = await app.request(`/api/projects/${projectId}/stories`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Route story" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; number: number; list: string };
    expect(createdBody.list).toBe("icebox");

    const listed = await app.request(`/api/projects/${projectId}/stories`, { headers });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toHaveLength(1);

    const read = await app.request(`/api/projects/${projectId}/stories/${createdBody.id}`, { headers });
    expect(read.status).toBe(200);

    const updated = await app.request(`/api/projects/${projectId}/stories/${createdBody.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { name: string }).name).toBe("Renamed");

    const deleted = await app.request(`/api/projects/${projectId}/stories/${createdBody.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(204);

    const afterDelete = await app.request(`/api/projects/${projectId}/stories/${createdBody.id}`, { headers });
    expect(afterDelete.status).toBe(404);
  });

  it("rejects an unknown field in the create body", async () => {
    const { projectId, app, headers } = setup();
    const res = await app.request(`/api/projects/${projectId}/stories`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "x", bogus: true }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "invalid_body" });
  });

  it("returns 409 invalid_transition through the PUT route", async () => {
    const { db, projectId, app, headers } = setup();
    const storyId = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ current_state: "delivered" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "invalid_transition" });
  });
  it("reorders through the PUT route and answers with the new position", async () => {
    const { db, projectId, app, headers } = setup();
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const c = seedStory(db, projectId);
    const res = await app.request(`/api/projects/${projectId}/stories/${c}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ after_id: a, before_id: b }),
    });
    expect(res.status).toBe(200);
    const moved = (await res.json()) as { position: number };
    expect(moved.position).toBe(1536);
    const listed = (await (await app.request(`/api/projects/${projectId}/stories`, { headers })).json()) as Array<{
      id: string;
    }>;
    expect(listed.map((s) => s.id)).toEqual([a, c, b]);
  });

  it("returns 409 manual_planning_required for group: current while planning is automatic", async () => {
    const { db, projectId, app, headers } = setup();
    const storyId = seedStory(db, projectId);
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ group: "current" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "manual_planning_required" });
  });

  it("moves a story out of the icebox when only group is sent", async () => {
    const { db, projectId, app, headers } = setup();
    const storyId = seedStory(db, projectId);
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ group: "scheduled" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { list: string; current_state: string }).toMatchObject({
      list: "backlog",
      current_state: "unstarted",
    });
  });
});

type Json = Record<string, unknown>;

async function send(app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, path: string, method: string, headers: Json, payload?: unknown) {
  const res = await app.request(path, {
    method,
    headers: headers as Record<string, string>,
    ...(payload === undefined ? {} : { body: typeof payload === "string" ? payload : JSON.stringify(payload) }),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

describe("POST /stories refuses states the database would refuse", () => {
  it("answers 409 manual_planning_required for planned under automatic planning", async () => {
    const { projectId, app, headers } = setup();
    const res = await send(app, `/api/projects/${projectId}/stories`, "POST", headers, { name: "p", current_state: "planned" });
    expect(res).toEqual({ status: 409, body: { error: "manual_planning_required" } });
  });

  it("answers 409 estimate_required for a started, unestimated feature", async () => {
    const { projectId, app, headers } = setup();
    const res = await send(app, `/api/projects/${projectId}/stories`, "POST", headers, { name: "s", current_state: "started" });
    expect(res).toEqual({ status: 409, body: { error: "estimate_required" } });
  });

  it("answers 409 invalid_transition for a started release", async () => {
    const { projectId, app, headers } = setup();
    const res = await send(app, `/api/projects/${projectId}/stories`, "POST", headers, {
      name: "r",
      story_type: "release",
      current_state: "started",
    });
    expect(res).toEqual({ status: 409, body: { error: "invalid_transition" } });
  });

  it("answers 409 invalid_transition for a delivered chore", async () => {
    const { projectId, app, headers } = setup();
    const res = await send(app, `/api/projects/${projectId}/stories`, "POST", headers, {
      name: "c",
      story_type: "chore",
      current_state: "delivered",
    });
    expect(res).toEqual({ status: 409, body: { error: "invalid_transition" } });
  });

  it("makes the creator an owner of a story created started, in the one create activity", async () => {
    const { db, owner, projectId, app, headers } = setup();
    const res = await send(app, `/api/projects/${projectId}/stories`, "POST", headers, {
      name: "s",
      current_state: "started",
      estimate: 1,
    });
    const userId = (owner as { userId: string }).userId;
    expect(res.status).toBe(201);
    expect(res.body.owner_ids).toEqual([userId]);
    const rows = db.select().from(activities).where(eq(activities.projectId, projectId)).all();
    expect(rows.map((r) => r.kind)).toEqual(["story_create_activity"]);
    expect(JSON.parse(rows[0]!.changes as unknown as string)[0].new_values).toEqual({ name: "s", owner_ids: [userId] });
  });
});

describe("PUT /stories keeps the unchanged state valid for a new type or estimate", () => {
  it("answers 409 estimate_required when a started feature loses its estimate", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "started", estimate: 1 });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { estimate: null });
    expect(res).toEqual({ status: 409, body: { error: "estimate_required" } });
  });

  it("answers 409 invalid_transition when a started feature becomes a release", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "started", estimate: 1 });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { story_type: "release" });
    expect(res).toEqual({ status: 409, body: { error: "invalid_transition" } });
  });
});

describe("PUT /stories with a group echoing the current list", () => {
  it("keeps the position and writes no move activity", async () => {
    const { db, projectId, app, headers } = setup();
    const b1 = seedStory(db, projectId, { list: "backlog", position: 2048 });
    seedStory(db, projectId, { list: "backlog", position: 3072 });
    const res = await send(app, `/api/projects/${projectId}/stories/${b1}`, "PUT", headers, { name: "Edited", group: "scheduled" });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(2048);
    const kinds = db.select().from(activities).where(eq(activities.projectId, projectId)).all().map((r) => r.kind);
    expect(kinds).toEqual(["story_update_activity"]);
    const listed = await send(app, `/api/projects/${projectId}/stories`, "GET", headers);
    expect((listed.body as unknown as { id: string }[])[0]!.id).toBe(b1);
  });
});

describe("GET /stories paging and label filter", () => {
  it("returns every story when no limit is given", async () => {
    const { db, projectId, app, headers } = setup();
    for (let i = 0; i < 501; i++) seedStory(db, projectId);
    const res = await send(app, `/api/projects/${projectId}/stories`, "GET", headers);
    expect(res.status).toBe(200);
    expect(res.body as unknown as unknown[]).toHaveLength(501);
  });

  it("pages with limit and offset", async () => {
    const { db, projectId, app, headers } = setup();
    const ids = [seedStory(db, projectId), seedStory(db, projectId), seedStory(db, projectId)];
    const first = await send(app, `/api/projects/${projectId}/stories?limit=2`, "GET", headers);
    expect((first.body as unknown as { id: string }[]).map((s) => s.id)).toEqual(ids.slice(0, 2));
    const rest = await send(app, `/api/projects/${projectId}/stories?limit=2&offset=2`, "GET", headers);
    expect((rest.body as unknown as { id: string }[]).map((s) => s.id)).toEqual(ids.slice(2));
    const offsetOnly = await send(app, `/api/projects/${projectId}/stories?offset=1`, "GET", headers);
    expect((offsetOnly.body as unknown as { id: string }[]).map((s) => s.id)).toEqual(ids.slice(1));
  });

  it("answers 400 limit_invalid and offset_invalid for out-of-range or non-integer values", async () => {
    const { projectId, app, headers } = setup();
    for (const q of ["limit=0", "limit=501", "limit=1.5", "limit=abc", "limit="]) {
      expect(await send(app, `/api/projects/${projectId}/stories?${q}`, "GET", headers)).toEqual({
        status: 400,
        body: { error: "limit_invalid" },
      });
    }
    for (const q of ["offset=-1", "offset=2.5", "offset=x"]) {
      expect(await send(app, `/api/projects/${projectId}/stories?${q}`, "GET", headers)).toEqual({
        status: 400,
        body: { error: "offset_invalid" },
      });
    }
  });

  it("filters by with_label and answers 404 for a label outside the project", async () => {
    const { db, projectId, owner, app, headers } = setup();
    const labelled = seedStory(db, projectId);
    seedStory(db, projectId);
    const labelId = seedLabel(db, projectId, "ux");
    db.insert(storyLabels).values({ projectId, storyId: labelled, labelId, addedAt: Date.now() }).run();
    const res = await send(app, `/api/projects/${projectId}/stories?with_label=${labelId}`, "GET", headers);
    expect((res.body as unknown as { id: string }[]).map((s) => s.id)).toEqual([labelled]);

    const otherProject = seedProject(db, owner);
    const foreignLabel = seedLabel(db, otherProject, "ux");
    expect(await send(app, `/api/projects/${projectId}/stories?with_label=${foreignLabel}`, "GET", headers)).toEqual({
      status: 404,
      body: { error: "not_found" },
    });
  });
});

describe("story routes body parsing", () => {
  it("answers 400 invalid_body for malformed JSON", async () => {
    const { projectId, app, headers } = setup();
    expect(await send(app, `/api/projects/${projectId}/stories`, "POST", headers, "{name:")).toEqual({
      status: 400,
      body: { error: "invalid_body" },
    });
  });
});
