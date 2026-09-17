import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { activities, labels as labelsTable, projects } from "../src/db/schema";
import { attachLabel, createEpic, deleteLabel, listLabels, renameLabel } from "../src/services/labels";
import { withProject } from "../src/db/tx";
import { makeTestApp, makeTestDb, seedLabel, seedProject, seedStory, seedUser } from "./harness";

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = seedProject(db, owner);
  return { db, owner, projectId };
}

describe("attachLabel / listLabels", () => {
  it("creates a label by name when a story is labelled with a new one", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const ids = withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "needs design"));
    expect(ids).toHaveLength(1);
    expect(withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx)).map((l) => l.name)).toEqual([
      "needs design",
    ]);
  });

  it("reuses an existing label case-insensitively instead of creating a twin", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "UX"));
    withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "ux"));
    expect(withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx))).toHaveLength(1);
  });

  it("counts stories, estimates and zero-point stories by state", () => {
    const { db, owner, projectId } = setup();
    const a = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 3 });
    const b = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 0 });
    withProject(db, owner, projectId, "label:write", (tx) => {
      attachLabel(tx, a, "ux");
      attachLabel(tx, b, "ux");
    });
    const [label] = withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx));
    expect(label!.counts.number_of_stories_by_state.unstarted).toBe(2);
    expect(label!.counts.sum_of_story_estimates_by_state.unstarted).toBe(3);
    expect(label!.counts.number_of_zero_point_stories_by_state.unstarted).toBe(1);
  });

  it("refuses to delete a label an epic is built on", () => {
    const { db, owner, projectId } = setup();
    const epic = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
    expect(() =>
      withProject(db, owner, projectId, "label:delete", (tx) => deleteLabel(tx, epic.label_id)),
    ).toThrow(/label_backs_an_epic/);
  });
});

describe("label and story-label routes", () => {
  it("attaches a label to a story by name via POST, creating it", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const storyId = seedStory(db, projectId);
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}/labels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "needs design" }),
    });
    expect(res.status).toBe(201);
    const story = (await res.json()) as { label_ids: string[] };
    expect(story.label_ids).toHaveLength(1);
    const listRes = await app.request(`/api/projects/${projectId}/labels`, { headers });
    const listed = (await listRes.json()) as { name: string }[];
    expect(listed.map((l) => l.name)).toEqual(["needs design"]);
  });

  it("detaches a label from a story via DELETE", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const storyId = seedStory(db, projectId);
    const labelId = withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "ux"))[0]!;
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}/labels/${labelId}`, {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(200);
    const story = (await res.json()) as { label_ids: string[] };
    expect(story.label_ids).toEqual([]);
  });

  it("refuses DELETE on a label backing an epic with 409", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const epic = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };
    const res = await app.request(`/api/projects/${projectId}/labels/${epic.label_id}`, {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "label_backs_an_epic" });
  });

  it("answers 404 (not 400) for a non-member's PUT with an over-long name — authorization runs before body validation", async () => {
    const { db, owner, projectId } = setup();
    const outsider = seedUser(db, "outsider@example.test");
    const { app } = makeTestApp(db);
    const labelId = withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, seedStory(db, projectId), "ux"))[0]!;
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(outsider) };
    const res = await app.request(`/api/projects/${projectId}/labels/${labelId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "x".repeat(200) }),
    });
    expect(res.status).toBe(404);
  });
});

describe("label names from the client", () => {
  const headersOf = (actor: unknown) => ({ "content-type": "application/json", "x-test-actor": JSON.stringify(actor) });

  it("answers 400 name_required for an empty or blank name on create and attach", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const storyId = seedStory(db, projectId);
    for (const name of ["", "   "]) {
      for (const path of [`/api/projects/${projectId}/labels`, `/api/projects/${projectId}/stories/${storyId}/labels`]) {
        const res = await app.request(path, { method: "POST", headers: headersOf(owner), body: JSON.stringify({ name }) });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "name_required" });
      }
    }
    expect(withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx))).toEqual([]);
  });

  it("stores the trimmed name, so \"Foo \" then \"foo\" resolve to one label", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    for (const [storyId, name] of [
      [a, "Foo "],
      [b, "foo"],
    ] as const) {
      const res = await app.request(`/api/projects/${projectId}/stories/${storyId}/labels`, {
        method: "POST",
        headers: headersOf(owner),
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(201);
    }
    const labels = withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx));
    expect(labels.map((l) => l.name)).toEqual(["Foo"]);
  });

  it("answers 400 name_required for a blank rename", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const labelId = seedLabel(db, projectId, "ux");
    const res = await app.request(`/api/projects/${projectId}/labels/${labelId}`, {
      method: "PUT",
      headers: headersOf(owner),
      body: JSON.stringify({ name: "  " }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name_required" });
  });

  it("writes nothing when a rename repeats the current name", () => {
    const { db, owner, projectId } = setup();
    const labelId = seedLabel(db, projectId, "ux");
    const before = db.select().from(labelsTable).where(eq(labelsTable.id, labelId)).get()!;
    const versionBefore = db.select().from(projects).where(eq(projects.id, projectId)).get()!.version;
    withProject(db, owner, projectId, "label:write", (tx) => renameLabel(tx, labelId, "ux"));
    expect(db.select().from(labelsTable).where(eq(labelsTable.id, labelId)).get()!.updatedAt).toBe(before.updatedAt);
    expect(db.select().from(projects).where(eq(projects.id, projectId)).get()!.version).toBe(versionBefore);
    expect(db.select().from(activities).where(eq(activities.projectId, projectId)).all()).toEqual([]);
  });

  it("answers 400 invalid_body for malformed JSON", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/labels`, { method: "POST", headers: headersOf(owner), body: "{" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});

describe("label routes answer 404 before body validation", () => {
  const headersOf = (actor: unknown) => ({ "content-type": "application/json", "x-test-actor": JSON.stringify(actor) });

  it("answers 404 for an unknown label with an unknown key", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/labels/00000000-0000-0000-0000-000000000000`, {
      method: "PUT",
      headers: headersOf(owner),
      body: JSON.stringify({ bogus: 1 }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("answers 404 for an unknown story with a blank label name", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/stories/00000000-0000-0000-0000-000000000000/labels`, {
      method: "POST",
      headers: headersOf(owner),
      body: JSON.stringify({ name: " " }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
