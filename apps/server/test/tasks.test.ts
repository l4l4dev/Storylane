import { describe, expect, it } from "bun:test";
import { createTask, deleteTask, listTasks, updateTask } from "../src/services/tasks";
import { withProject } from "../src/db/tx";
import { makeTestApp, makeTestDb, seedBlocker, seedProject, seedReview, seedReviewType, seedStory, seedTask, seedUser } from "./harness";

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = seedProject(db, owner);
  return { db, owner, projectId };
}

describe("createTask / listTasks / updateTask / deleteTask", () => {
  it("appends tasks and numbers them from 1 on the wire", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const a = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "first" }));
    const b = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "second" }));
    expect([a.position, b.position]).toEqual([1, 2]);
  });

  it("moves a task to a given position and closes the gap it left", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const ids = ["a", "b", "c"].map((d) =>
      withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: d })).id,
    );
    withProject(db, owner, projectId, "task:write", (tx) => updateTask(tx, ids[2]!, { position: 1 }));
    const after = withProject(db, owner, projectId, "story:read", (tx) => listTasks(tx, storyId));
    expect(after.map((t) => t.description)).toEqual(["c", "a", "b"]);
    expect(after.map((t) => t.position)).toEqual([1, 2, 3]);
  });

  it("refuses a position outside the list", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const task = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "a" }));
    expect(() =>
      withProject(db, owner, projectId, "task:write", (tx) => updateTask(tx, task.id, { position: 0 })),
    ).toThrow(/position_out_of_range/);
  });

  it("refuses a task on a story in another project", () => {
    const { db, owner, projectId } = setup();
    const other = seedProject(db, owner);
    const foreign = seedStory(db, other);
    expect(() =>
      withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, foreign, { description: "a" })),
    ).toThrow(/not_found/);
  });

  it("closes the gap when a task is deleted", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const ids = ["a", "b", "c"].map((d) =>
      withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: d })).id,
    );
    withProject(db, owner, projectId, "task:write", (tx) => deleteTask(tx, ids[0]!));
    expect(withProject(db, owner, projectId, "story:read", (tx) => listTasks(tx, storyId)).map((t) => t.position)).toEqual([
      1, 2,
    ]);
  });

  it("creates a task at an explicit position in the middle", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const ids = ["a", "b"].map((d) =>
      withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: d })).id,
    );
    withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "mid", position: 2 }));
    const after = withProject(db, owner, projectId, "story:read", (tx) => listTasks(tx, storyId));
    expect(after.map((t) => t.description)).toEqual(["a", "mid", "b"]);
    expect(after.map((t) => t.position)).toEqual([1, 2, 3]);
    expect(ids).toHaveLength(2);
  });

  it("writes no activity and no update on a no-op patch", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const task = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "a" }));
    const before = task.updated_at;
    const after = withProject(db, owner, projectId, "task:write", (tx) =>
      updateTask(tx, task.id, { description: "a", complete: false }),
    );
    expect(after.updated_at).toBe(before);
  });
});

describe("task routes", () => {
  it("GET lists tasks, POST creates one, PUT updates it, DELETE removes it", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const storyId = seedStory(db, projectId);
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };

    const listEmpty = await app.request(`/api/projects/${projectId}/stories/${storyId}/tasks`, { headers });
    expect(listEmpty.status).toBe(200);
    expect((await listEmpty.json()) as unknown[]).toEqual([]);

    const createRes = await app.request(`/api/projects/${projectId}/stories/${storyId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ description: "write tests" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; position: number };
    expect(created.position).toBe(1);

    const putRes = await app.request(`/api/projects/${projectId}/stories/${storyId}/tasks/${created.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ complete: true }),
    });
    expect(putRes.status).toBe(200);
    expect((await putRes.json()) as { complete: boolean }).toMatchObject({ complete: true });

    const deleteRes = await app.request(`/api/projects/${projectId}/stories/${storyId}/tasks/${created.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteRes.status).toBe(204);

    const listAfter = await app.request(`/api/projects/${projectId}/stories/${storyId}/tasks`, { headers });
    expect((await listAfter.json()) as unknown[]).toEqual([]);
  });

  it("refuses a viewer's POST with 403", async () => {
    const { db, owner } = setup();
    const viewer = seedUser(db, "viewer@example.test");
    const withViewerProjectId = seedProject(db, owner, [[viewer, "viewer"]]);
    const { app } = makeTestApp(db);
    const storyId = seedStory(db, withViewerProjectId);
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(viewer) };
    const res = await app.request(`/api/projects/${withViewerProjectId}/stories/${storyId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ description: "nope" }),
    });
    expect(res.status).toBe(403);
  });

  it("answers 403 (not 400) for a viewer's POST with an empty description — authorization runs before body validation", async () => {
    const { db, owner } = setup();
    const viewer = seedUser(db, "viewer@example.test");
    const withViewerProjectId = seedProject(db, owner, [[viewer, "viewer"]]);
    const { app } = makeTestApp(db);
    const storyId = seedStory(db, withViewerProjectId);
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(viewer) };
    const res = await app.request(`/api/projects/${withViewerProjectId}/stories/${storyId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ description: "" }),
    });
    expect(res.status).toBe(403);
  });

  it("404s a taskId that belongs to a different story", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const storyA = seedStory(db, projectId);
    const storyB = seedStory(db, projectId);
    const taskOnA = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyA, { description: "a" })).id;
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };
    const res = await app.request(`/api/projects/${projectId}/stories/${storyB}/tasks/${taskOnA}`, {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(404);
  });
});

describe("story-part PUT resolves the child before validating the body", () => {
  const headersOf = (actor: unknown) => ({ "content-type": "application/json", "x-test-actor": JSON.stringify(actor) });

  it("answers 404 for a task, blocker or review on another story even with an unknown field", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const here = seedStory(db, projectId);
    const there = seedStory(db, projectId);
    const children = {
      tasks: seedTask(db, projectId, there, "elsewhere"),
      blockers: seedBlocker(db, projectId, there, owner),
      reviews: seedReview(db, projectId, there, seedReviewType(db, projectId)),
    };
    for (const [part, childId] of Object.entries(children)) {
      const res = await app.request(`/api/projects/${projectId}/stories/${here}/${part}/${childId}`, {
        method: "PUT",
        headers: headersOf(owner),
        body: JSON.stringify({ bogus: 1 }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("answers 400 invalid_body for malformed JSON", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const storyId = seedStory(db, projectId);
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}/tasks`, {
      method: "POST",
      headers: headersOf(owner),
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});
