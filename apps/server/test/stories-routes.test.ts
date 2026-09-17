import { describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedProject, seedStory, seedUser } from "./harness";

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
});
