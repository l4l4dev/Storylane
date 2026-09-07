import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { ACTION_LABEL_MAX, DESCRIPTION_MAX, NAME_MAX, TITLE_MAX } from "../src/routes/limits";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> };
let projectId: string;
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor: Actor) => ({ ...as(actor), "content-type": "application/json", origin: ORIGIN });

const send = (method: string, path: string, bodyValue: unknown) =>
  app.request(`${ORIGIN}${path}`, { method, headers: jsonAs(owner), body: JSON.stringify(bodyValue) });

const errorOf = async (res: Response | Promise<Response>) => {
  const settled = await res;
  return { status: settled.status, ...(await settled.json()) } as { status: number; error: string };
};

const over = (max: number) => "x".repeat(max + 1);

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  app = makeTestApp(db).app;
  projectId = createProject(db, owner, { name: "P" }).id;
});

/** A free-text field with no bound is unbounded `/data` growth for any signed-in member. */
describe("length bounds", () => {
  it("refuses an over-long project name on create", async () => {
    expect(await errorOf(send("POST", "/api/projects", { name: over(NAME_MAX) }))).toEqual({
      status: 400,
      error: "name_too_long",
    });
  });

  it("refuses an over-long state name and action label on create", async () => {
    expect(
      await errorOf(send("POST", `/api/projects/${projectId}/states`, { name: over(NAME_MAX), category: "unstarted" })),
    ).toEqual({ status: 400, error: "name_too_long" });
    expect(
      await errorOf(
        send("POST", `/api/projects/${projectId}/states`, {
          name: "Review",
          category: "unstarted",
          actionLabel: over(ACTION_LABEL_MAX),
        }),
      ),
    ).toEqual({ status: 400, error: "action_label_too_long" });
  });

  it("refuses an over-long state name and action label on patch", async () => {
    const states = (await (await app.request(`${ORIGIN}/api/projects/${projectId}/states`, { headers: as(owner) })).json()) as Array<{ id: string }>;
    const stateId = states[0]!.id;
    const path = `/api/projects/${projectId}/states/${stateId}`;
    expect(await errorOf(send("PATCH", path, { name: over(NAME_MAX) }))).toEqual({ status: 400, error: "name_too_long" });
    expect(await errorOf(send("PATCH", path, { actionLabel: over(ACTION_LABEL_MAX) }))).toEqual({
      status: 400,
      error: "action_label_too_long",
    });
  });

  it("refuses an over-long story title and description on create", async () => {
    const path = `/api/projects/${projectId}/stories`;
    expect(await errorOf(send("POST", path, { title: over(TITLE_MAX) }))).toEqual({ status: 400, error: "title_too_long" });
    expect(await errorOf(send("POST", path, { title: "ok", description: over(DESCRIPTION_MAX) }))).toEqual({
      status: 400,
      error: "description_too_long",
    });
  });

  it("refuses an over-long story title and description on patch", async () => {
    const created = await (await send("POST", `/api/projects/${projectId}/stories`, { title: "ok" })).json();
    const path = `/api/projects/${projectId}/stories/${(created as { id: string }).id}`;
    expect(await errorOf(send("PATCH", path, { title: over(TITLE_MAX) }))).toEqual({ status: 400, error: "title_too_long" });
    expect(await errorOf(send("PATCH", path, { description: over(DESCRIPTION_MAX) }))).toEqual({
      status: 400,
      error: "description_too_long",
    });
  });

  it("accepts a title and description exactly at the bound", async () => {
    const res = await send("POST", `/api/projects/${projectId}/stories`, {
      title: "x".repeat(TITLE_MAX),
      description: "x".repeat(DESCRIPTION_MAX),
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/projects/:id/stories unknown keys", () => {
  it("refuses an unknown key the same way PATCH does", async () => {
    expect(await errorOf(send("POST", `/api/projects/${projectId}/stories`, { title: "ok", nope: 1 }))).toEqual({
      status: 400,
      error: "invalid_body",
    });
  });

  it("still accepts every documented create key", async () => {
    const res = await send("POST", `/api/projects/${projectId}/stories`, {
      title: "ok",
      description: null,
      storyType: "chore",
      points: null,
      stateId: null,
      assigneeId: null,
    });
    expect(res.status).toBe(201);
  });
});
