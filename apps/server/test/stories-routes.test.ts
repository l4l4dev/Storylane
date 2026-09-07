import { beforeEach, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { listStates } from "../src/services/states";
import { withProject, type Actor } from "../src/db/tx";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let member: Actor;
let viewer: Actor;
let projectId: string;
let stateIds: Record<string, string>;
let app: Hono;
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor: Actor) => ({ ...as(actor), "content-type": "application/json", origin: ORIGIN });

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
  viewer = seedUser(db, "viewer@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  for (const [actor, role] of [
    [member, "member"],
    [viewer, "viewer"],
  ] as const) {
    db.$client.run("insert into project_members (project_id, user_id, role, joined_at) values (?,?,?,?)", [
      projectId,
      (actor as { userId: string }).userId,
      role,
      Date.now(),
    ]);
  }
  const states = withProject(db, owner, projectId, "state:read", (tx) => listStates(tx));
  stateIds = Object.fromEntries(states.map((s) => [s.category, s.id]));
  app = makeTestApp(db).app;
});

const createStory = (actor: Actor, body: unknown) =>
  app.request(`${ORIGIN}/api/projects/${projectId}/stories`, {
    method: "POST",
    headers: jsonAs(actor),
    body: JSON.stringify(body),
  });

describe("story routes", () => {
  it("lets a member create and move a story, and a viewer only read", async () => {
    const created = await createStory(member, { title: "Ship it", points: 2, stateId: stateIds.unstarted });
    expect(created.status).toBe(201);
    const story = (await created.json()) as { id: string; number: number };
    expect(story.number).toBe(1);

    const forbidden = await createStory(viewer, { title: "No" });
    expect(forbidden.status).toBe(403);

    const board = await app.request(`${ORIGIN}/api/projects/${projectId}/board`, { headers: as(viewer) });
    expect(board.status).toBe(200);

    const moved = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}/move`, {
      method: "POST",
      headers: jsonAs(member),
      body: JSON.stringify({ stateId: stateIds.done, orderedIds: [story.id] }),
    });
    expect(moved.status).toBe(200);
    expect((await moved.json()) as { completedAt: number | null }).toMatchObject({ stateId: stateIds.done });
    expect(
      (
        (await (
          await app.request(`${ORIGIN}/api/projects/${projectId}/board`, { headers: as(member) })
        ).json()) as { columns: Array<{ stateId: string | null; stories: unknown[] }> }
      ).columns.find((c) => c.stateId === stateIds.done)!.stories,
    ).toHaveLength(1);
  });

  it("only the owner may delete", async () => {
    const story = (await (await createStory(member, { title: "a" })).json()) as { id: string };
    const asMember = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}`, {
      method: "DELETE",
      headers: jsonAs(member),
    });
    expect(asMember.status).toBe(403);
    const asOwner = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(asOwner.status).toBe(204);
  });

  it("surfaces the estimation gate as 409 and an off-scale estimate as 400", async () => {
    const gated = await createStory(member, { title: "a", stateId: stateIds.in_progress });
    expect(gated.status).toBe(409);
    expect(await gated.json()).toEqual({ error: "estimate_required" });
    const offScale = await createStory(member, { title: "a", points: 4 });
    expect(offScale.status).toBe(400);
    expect(await offScale.json()).toEqual({ error: "points_off_scale" });
  });

  it("rejects an unknown story type with 400 and a foreign story id with 404", async () => {
    const badType = await createStory(member, { title: "a", storyType: "epic" });
    expect(badType.status).toBe(400);
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = (await (
      await app.request(`${ORIGIN}/api/projects/${other}/stories`, {
        method: "POST",
        headers: jsonAs(owner),
        body: JSON.stringify({ title: "x" }),
      })
    ).json()) as { id: string };
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${foreign.id}`, {
      method: "PATCH",
      headers: jsonAs(member),
      body: JSON.stringify({ title: "hijack" }),
    });
    expect(res.status).toBe(404);

    const moved = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${foreign.id}/move`, {
      method: "POST",
      headers: jsonAs(member),
      body: JSON.stringify({ stateId: null, orderedIds: [] }),
    });
    expect(moved.status).toBe(404);

    const deleted = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${foreign.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(deleted.status).toBe(404);
  });

  it("authorizes before it judges the body", async () => {
    // A viewer sending a nonsense body must still learn only that she may not write.
    const asViewer = await createStory(viewer, { title: 42, storyType: "epic" });
    expect(asViewer.status).toBe(403);
    const outsider = seedUser(db, "outsider@example.test");
    const asOutsider = await createStory(outsider, { points: "many" });
    expect(asOutsider.status).toBe(404);
    const anonymous = await app.request(`${ORIGIN}/api/projects/${projectId}/stories`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ storyType: "epic" }),
    });
    expect(anonymous.status).toBe(401);
  });
});

describe("story PATCH body is strict", () => {
  it("refuses stateId (moves go through /move) and any unknown key", async () => {
    const story = (await (await createStory(member, { title: "a" })).json()) as { id: string; stateId: null };
    const patch = (body: unknown) =>
      app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}`, {
        method: "PATCH",
        headers: jsonAs(member),
        body: JSON.stringify(body),
      });

    const withState = await patch({ stateId: stateIds.done });
    expect(withState.status).toBe(400);
    expect(await withState.json()).toEqual({ error: "state_id_unsupported" });

    // A foreign id must not be accepted-and-ignored either: silently 200-unchanged would read
    // as a successful move to the caller.
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreignState = withProject(db, owner, other, "state:read", (tx) => listStates(tx))[0]!.id;
    const withForeignState = await patch({ stateId: foreignState });
    expect(withForeignState.status).toBe(400);

    const unknown = await patch({ titel: "typo" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "invalid_body" });

    // The story really is untouched by all of the above.
    const after = (await (
      await app.request(`${ORIGIN}/api/projects/${projectId}/stories`, { headers: as(member) })
    ).json()) as Array<{ id: string; title: string; stateId: string | null }>;
    expect(after.find((s) => s.id === story.id)).toMatchObject({ title: "a", stateId: null });
  });
});

describe("story routes on an archived project", () => {
  const archive = () =>
    app.request(`${ORIGIN}/api/projects/${projectId}/archive`, { method: "POST", headers: jsonAs(owner) });

  it("refuses writes with 409 for member and viewer alike, but still serves the board", async () => {
    const story = (await (await createStory(member, { title: "a" })).json()) as { id: string };
    expect((await archive()).status).toBe(200);

    for (const actor of [member, viewer]) {
      const created = await createStory(actor, { title: "later" });
      expect(created.status).toBe(409);
      expect(await created.json()).toEqual({ error: "project_archived" });

      const moved = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}/move`, {
        method: "POST",
        headers: jsonAs(actor),
        body: JSON.stringify({ stateId: stateIds.done, orderedIds: [story.id] }),
      });
      expect(moved.status).toBe(409);
      expect(await moved.json()).toEqual({ error: "project_archived" });

      const board = await app.request(`${ORIGIN}/api/projects/${projectId}/board`, { headers: as(actor) });
      expect(board.status).toBe(200);
    }
  });
});

describe("story routes reject ids from outside the project", () => {
  it("404s a move onto another project's state", async () => {
    const story = (await (await createStory(member, { title: "a", points: 1 })).json()) as { id: string };
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreignState = withProject(db, owner, other, "state:read", (tx) => listStates(tx))[0]!.id;
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}/move`, {
      method: "POST",
      headers: jsonAs(member),
      body: JSON.stringify({ stateId: foreignState, orderedIds: [story.id] }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("400s an assignee who is not a member, on create and on PATCH", async () => {
    const outsider = seedUser(db, "outsider@example.test");
    if (outsider.kind !== "user") throw new Error("unreachable");
    const created = await createStory(member, { title: "a", assigneeId: outsider.userId });
    expect(created.status).toBe(400);
    expect(await created.json()).toEqual({ error: "assignee_not_member" });

    const story = (await (await createStory(member, { title: "b" })).json()) as { id: string };
    const patched = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}`, {
      method: "PATCH",
      headers: jsonAs(member),
      body: JSON.stringify({ assigneeId: outsider.userId }),
    });
    expect(patched.status).toBe(400);
    expect(await patched.json()).toEqual({ error: "assignee_not_member" });
  });
});
