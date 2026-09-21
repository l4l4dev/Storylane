import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { activities, projects, stories, storyLabels } from "../src/db/schema";
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

  it("filters by with_state and with_story_type", async () => {
    const { db, projectId, app, headers } = setup();
    const icebox = seedStory(db, projectId, { storyType: "feature" });
    const started = seedStory(db, projectId, { list: "backlog", currentState: "started", storyType: "feature", estimate: 1 });
    const chore = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", storyType: "chore" });

    const ids = async (query: string) =>
      ((await send(app, `/api/projects/${projectId}/stories?${query}`, "GET", headers)).body as unknown as {
        id: string;
      }[]).map((s) => s.id);

    expect(await ids("with_state=started")).toEqual([started]);
    expect((await ids("with_state=started,unstarted")).sort()).toEqual([started, chore].sort());
    expect(await ids("with_state=started,unstarted&with_story_type=chore")).toEqual([chore]);
    expect(await ids("with_story_type=feature&with_state=unscheduled")).toEqual([icebox]);
  });

  it("combines with_state with with_label", async () => {
    const { db, projectId, app, headers } = setup();
    const labelled = seedStory(db, projectId, { list: "backlog", currentState: "started", estimate: 1 });
    seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const labelId = seedLabel(db, projectId, "ux");
    db.insert(storyLabels).values({ projectId, storyId: labelled, labelId, addedAt: Date.now() }).run();
    const other = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    db.insert(storyLabels).values({ projectId, storyId: other, labelId, addedAt: Date.now() }).run();

    const res = await send(app, `/api/projects/${projectId}/stories?with_label=${labelId}&with_state=started`, "GET", headers);
    expect((res.body as unknown as { id: string }[]).map((s) => s.id)).toEqual([labelled]);
  });

  it("answers 400 for an unknown or empty filter value", async () => {
    const { projectId, app, headers } = setup();
    const cases: [string, string][] = [
      ["with_state=bogus", "with_state_invalid"],
      ["with_state=", "with_state_invalid"],
      ["with_state=started,bogus", "with_state_invalid"],
      ["with_story_type=bogus", "with_story_type_invalid"],
      ["with_story_type=", "with_story_type_invalid"],
    ];
    for (const [query, error] of cases) {
      expect(await send(app, `/api/projects/${projectId}/stories?${query}`, "GET", headers)).toEqual({
        status: 400,
        body: { error },
      });
    }
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

function manualPlanning(db: ReturnType<typeof makeTestDb>, projectId: string): void {
  db.update(projects).set({ automaticPlanning: false }).where(eq(projects.id, projectId)).run();
}

function lastActivity(db: ReturnType<typeof makeTestDb>, projectId: string) {
  const rows = db.select().from(activities).where(eq(activities.projectId, projectId)).all();
  return { kinds: rows.map((r) => r.kind), last: rows.at(-1) };
}

describe("story triggers are answered by the service, never by a 500", () => {
  it("clears the estimate when an estimated feature becomes a release, in the one update activity", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 2 });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { story_type: "release" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ story_type: "release", estimate: null });
    const { kinds, last } = lastActivity(db, projectId);
    expect(kinds).toEqual(["story_update_activity"]);
    const change = JSON.parse(last!.changes as unknown as string)[0];
    expect(change.original_values).toEqual({ story_type: "feature", estimate: 2 });
    expect(change.new_values).toEqual({ story_type: "release", estimate: null });
  });

  it("answers 400 estimate_not_allowed for an estimate on an existing release", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", storyType: "release" });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { estimate: 1 });
    expect(res).toEqual({ status: 400, body: { error: "estimate_not_allowed" } });
  });

  it("answers 400 estimate_not_allowed for a type change to release that also sends an estimate", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 2 });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { story_type: "release", estimate: 2 });
    expect(res).toEqual({ status: 400, body: { error: "estimate_not_allowed" } });
  });

  it("answers 400 estimate_not_allowed for a release created with an estimate", async () => {
    const { projectId, app, headers } = setup();
    const res = await send(app, `/api/projects/${projectId}/stories`, "POST", headers, { name: "r", story_type: "release", estimate: 2 });
    expect(res).toEqual({ status: 400, body: { error: "estimate_not_allowed" } });
  });

  it("answers 409 manual_planning_required for current_state planned under automatic planning", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { current_state: "planned" });
    expect(res).toEqual({ status: 409, body: { error: "manual_planning_required" } });
  });

  it("answers 400 deadline_release_only for a release turned feature that resends its deadline", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", storyType: "release" });
    db.update(stories).set({ deadline: 1_800_000_000_000 }).where(eq(stories.id, id)).run();
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, {
      story_type: "feature",
      deadline: 1_800_000_000_000,
    });
    expect(res).toEqual({ status: 400, body: { error: "deadline_release_only" } });
  });
});

describe("PUT /stories with both group and current_state", () => {
  it("answers 400 group_state_mismatch for scheduled with unscheduled", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "scheduled", current_state: "unscheduled" });
    expect(res).toEqual({ status: 400, body: { error: "group_state_mismatch" } });
  });

  it("answers 400 group_state_mismatch for unscheduled with unstarted", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId);
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "unscheduled", current_state: "unstarted" });
    expect(res).toEqual({ status: 400, body: { error: "group_state_mismatch" } });
  });

  it("answers 400 group_state_mismatch for current with a state outside Current", async () => {
    const { db, projectId, app, headers } = setup();
    manualPlanning(db, projectId);
    const id = seedStory(db, projectId);
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "current", current_state: "unstarted" });
    expect(res).toEqual({ status: 400, body: { error: "group_state_mismatch" } });
  });

  it("answers 409 manual_planning_required ahead of a mismatch", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId);
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "current", current_state: "unstarted" });
    expect(res).toEqual({ status: 409, body: { error: "manual_planning_required" } });
  });

  it("answers 400 group_state_mismatch for scheduled with planned", async () => {
    const { db, projectId, app, headers } = setup();
    manualPlanning(db, projectId);
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "scheduled", current_state: "planned" });
    expect(res).toEqual({ status: 400, body: { error: "group_state_mismatch" } });
  });

  it("unplans a planned story sent scheduled with unstarted", async () => {
    const { db, projectId, app, headers } = setup();
    manualPlanning(db, projectId);
    const id = seedStory(db, projectId, { list: "backlog", currentState: "planned" });
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "scheduled", current_state: "unstarted" });
    expect(res.status).toBe(200);
    expect(res.body.current_state).toBe("unstarted");
  });

  it("applies an agreeing group and state", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId);
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "scheduled", current_state: "unstarted" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ list: "backlog", current_state: "unstarted" });
  });
});

describe("PUT /stories group maps to Tracker panel states", () => {
  it("reorders a started story inside Current without touching its state", async () => {
    const { db, projectId, app, headers } = setup();
    manualPlanning(db, projectId);
    const started = seedStory(db, projectId, { list: "backlog", currentState: "started", estimate: 1 });
    const planned = seedStory(db, projectId, { list: "backlog", currentState: "planned" });
    const before = db.select({ p: stories.position }).from(stories).where(eq(stories.id, started)).get()!.p;
    const res = await send(app, `/api/projects/${projectId}/stories/${started}`, "PUT", headers, { group: "current", after_id: planned });
    expect(res.status).toBe(200);
    expect(res.body.current_state).toBe("started");
    expect(res.body.position).not.toBe(before);
    const listed = await send(app, `/api/projects/${projectId}/stories`, "GET", headers);
    expect((listed.body as unknown as { id: string }[]).map((s) => s.id)).toEqual([planned, started]);
  });

  it("unplans a planned story dropped after a backlog story", async () => {
    const { db, projectId, app, headers } = setup();
    manualPlanning(db, projectId);
    const planned = seedStory(db, projectId, { list: "backlog", currentState: "planned" });
    const u1 = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const u2 = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const res = await send(app, `/api/projects/${projectId}/stories/${planned}`, "PUT", headers, { group: "scheduled", after_id: u1 });
    expect(res.status).toBe(200);
    expect(res.body.current_state).toBe("unstarted");
    const listed = await send(app, `/api/projects/${projectId}/stories`, "GET", headers);
    expect((listed.body as unknown as { id: string }[]).map((s) => s.id)).toEqual([u1, planned, u2]);
  });

  it("unplans a planned story in place when no neighbour is given", async () => {
    const { db, projectId, app, headers } = setup();
    manualPlanning(db, projectId);
    const planned = seedStory(db, projectId, { list: "backlog", currentState: "planned" });
    seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const before = db.select({ p: stories.position }).from(stories).where(eq(stories.id, planned)).get()!.p;
    const res = await send(app, `/api/projects/${projectId}/stories/${planned}`, "PUT", headers, { group: "scheduled" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ current_state: "unstarted", list: "backlog", position: before });
    const { kinds, last } = lastActivity(db, projectId);
    expect(kinds).toEqual(["story_update_activity"]);
    expect(JSON.parse(last!.changes as unknown as string)[0].new_values).toEqual({ current_state: "unstarted" });
  });

  it("treats scheduled on an unstarted backlog story as a no-op", async () => {
    const { db, projectId, app, headers } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const before = db.select({ p: stories.position }).from(stories).where(eq(stories.id, id)).get()!.p;
    const res = await send(app, `/api/projects/${projectId}/stories/${id}`, "PUT", headers, { group: "scheduled" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ current_state: "unstarted", position: before });
    expect(lastActivity(db, projectId).kinds).toEqual([]);
  });
});
