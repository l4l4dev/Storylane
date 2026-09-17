import { afterEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedProject, seedStory, seedUser } from "./harness";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const viewer = seedUser(db, "viewer@example.test");
  const projectId = seedProject(db, owner, [[viewer, "viewer"]]);
  const storyId = seedStory(db, projectId);
  const { app } = makeTestApp(db);
  return { owner, viewer, projectId, storyId, app };
}

describe("story owner/follower routes", () => {
  it("viewer targets another user → 403", async () => {
    const { owner, viewer, projectId, storyId, app } = setup();
    const headers = { "x-test-actor": JSON.stringify(viewer), "content-type": "application/json" };
    const res = await app.request(
      `/api/projects/${projectId}/stories/${storyId}/followers/${(owner as { userId: string }).userId}`,
      { method: "POST", headers, body: "{}" },
    );
    expect(res.status).toBe(403);
  });

  it("viewer follows only itself via /follow", async () => {
    const { viewer, projectId, storyId, app } = setup();
    const headers = { "x-test-actor": JSON.stringify(viewer), "content-type": "application/json" };
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}/follow`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { follower_ids: string[] };
    expect(body.follower_ids).toContain((viewer as { userId: string }).userId);
  });

  it("a repeated follow is a no-op that still succeeds, even in development", async () => {
    const { viewer, projectId, storyId, app } = setup();
    process.env.NODE_ENV = "development";
    const headers = { "x-test-actor": JSON.stringify(viewer), "content-type": "application/json" };
    const first = await app.request(`/api/projects/${projectId}/stories/${storyId}/follow`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(first.status).toBe(200);
    // The second call records no activity (the viewer already follows), so the dev-only
    // version-unchanged check must warn, not throw a 500.
    const second = await app.request(`/api/projects/${projectId}/stories/${storyId}/follow`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { follower_ids: string[] };
    expect(body.follower_ids).toContain((viewer as { userId: string }).userId);
  });

  it("refuses to follow on an archived project", async () => {
    const { owner, projectId, storyId, app } = setup();
    const headers = { "x-test-actor": JSON.stringify(owner), "content-type": "application/json" };
    await app.request(`/api/projects/${projectId}/archive`, { method: "POST", headers, body: "{}" });
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}/follow`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
  });
});
