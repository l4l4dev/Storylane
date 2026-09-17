import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedProject, seedStory, seedUser } from "./harness";
import { withProject } from "../src/db/tx";
import { listActivity, projectVersion, recordActivity, storyActivity } from "../src/services/activity";
import { createProject, setArchived, updateProject } from "../src/services/projects";
import type { ActivityRow } from "../src/services/activity";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let projectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = seedProject(db, owner);
});

const entry = (name: string) => ({
  kind: "story_update_activity" as const,
  message: `Owner edited ${name}`,
  highlight: "edited",
  changes: [
    {
      kind: "story",
      id: "s1",
      number: 1,
      change_type: "update" as const,
      original_values: { name: "before" },
      new_values: { name },
    },
  ],
  primaryResources: [{ kind: "story", id: "s1" }],
});

describe("recordActivity", () => {
  it("bumps the project version once per row and stamps it on the row", () => {
    const [first, second] = withProject(db, owner, projectId, "story:write", (tx) => [
      recordActivity(tx, entry("one")),
      recordActivity(tx, entry("two")),
    ]);
    expect(first.projectVersion).toBe(1);
    expect(second.projectVersion).toBe(2);
    const version = withProject(db, owner, projectId, "activity:read", (tx) => projectVersion(tx));
    expect(version).toBe(2);
  });

  it("returns rows after a version and never the version itself", () => {
    withProject(db, owner, projectId, "story:write", (tx) => {
      recordActivity(tx, entry("one"));
      recordActivity(tx, entry("two"));
      recordActivity(tx, entry("three"));
    });
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, { sinceVersion: 1 }));
    expect(rows.map((r) => r.project_version)).toEqual([2, 3]);
    expect(rows[0]!.guid).toBe(`${projectId}_2`);
    expect(rows[0]!.changes[0]!.new_values).toEqual({ name: "two" });
  });

  it("indexes primary and secondary resources so a story's own activity is a lookup", () => {
    const storyId = seedStory(db, projectId);
    withProject(db, owner, projectId, "story:write", (tx) => {
      recordActivity(tx, { ...entry("one"), primaryResources: [{ kind: "story", id: storyId }] });
      recordActivity(tx, { ...entry("elsewhere"), primaryResources: [{ kind: "story", id: "other" }] });
    });
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => storyActivity(tx, storyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message).toBe("Owner edited one");
  });

  it("returns an activity once even when the same story is both primary and secondary", () => {
    const storyId = seedStory(db, projectId);
    withProject(db, owner, projectId, "story:write", (tx) => {
      recordActivity(tx, {
        ...entry("both"),
        primaryResources: [{ kind: "story", id: storyId }],
        secondaryResources: [{ kind: "story", id: storyId }],
      });
    });
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => storyActivity(tx, storyId));
    expect(rows).toHaveLength(1);
  });

  it("refuses a kind outside the enum", () => {
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) =>
        recordActivity(tx, { ...entry("x"), kind: "story_exploded_activity" as never }),
      ),
    ).toThrow(/unknown activity kind/);
  });

  it("never snapshots a display name into the payload", () => {
    // The message is rendered at write time from the actor, but performed_by_id is what a
    // reader resolves — a renamed user must not leave stale names in old rows.
    const [recorded] = withProject(db, owner, projectId, "story:write", (tx) => [recordActivity(tx, entry("one"))]);
    expect(recorded.projectVersion).toBe(1);
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    expect(rows[0]!.performed_by_id).toBe((owner as { userId: string }).userId);
  });
});

describe("activity payloads", () => {
  it("records a project update with snake_case column names, not Drizzle's property names", () => {
    const project = createProject(db, owner, { name: "P" });
    withProject(db, owner, project.id, "project:update", (tx) =>
      updateProject(tx, { name: "Renamed", description: "d", point_scale: "0,1,2,4,8" }),
    );
    const rows = withProject(db, owner, project.id, "activity:read", (tx) => listActivity(tx, {}));
    const update = rows.at(-1)!;
    expect(Object.keys(update.changes[0]!.new_values!).sort()).toEqual(["description", "name", "point_scale"]);
    expect(update.changes[0]!.new_values!.point_scale).toBe("0,1,2,4,8");
  });

  it("records an archive as the column it wrote", () => {
    const project = createProject(db, owner, { name: "P" });
    withProject(db, owner, project.id, "project:archive", (tx) => setArchived(tx, true));
    const rows = withProject(db, owner, project.id, "activity:read", (tx) => listActivity(tx, {}));
    const values = rows.at(-1)!.changes[0]!.new_values!;
    expect(Object.keys(values)).toEqual(["archived_at"]);
    expect(typeof values.archived_at).toBe("number");
  });
});

describe("GET /api/projects/:id/activity", () => {
  const ORIGIN = "http://127.0.0.1";
  const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });

  it("authorizes before it validates the query", async () => {
    const app = makeTestApp(db).app;
    // Anonymous with an invalid since_version: 401 wins over the 400 the query would earn.
    const anon = await app.request(`${ORIGIN}/api/projects/${projectId}/activity?since_version=-1`);
    expect(anon.status).toBe(401);
    const stranger = seedUser(db, "stranger@example.test");
    const outsider = await app.request(`${ORIGIN}/api/projects/${projectId}/activity?since_version=-1`, {
      headers: as(stranger),
    });
    expect(outsider.status).toBe(404);
    const member = await app.request(`${ORIGIN}/api/projects/${projectId}/activity?since_version=-1`, {
      headers: as(owner),
    });
    expect(member.status).toBe(400);
    expect(await member.json()).toEqual({ error: "since_version_invalid" });
  });

  it("returns the rows after since_version", async () => {
    const app = makeTestApp(db).app;
    withProject(db, owner, projectId, "story:write", (tx) => {
      recordActivity(tx, entry("one"));
      recordActivity(tx, entry("two"));
    });
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/activity?since_version=1`, {
      headers: as(owner),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as ActivityRow[];
    expect(rows.map((r) => r.project_version)).toEqual([2]);
    expect(rows[0]!.message).toBe("Owner edited two");
  });

  it("400s an empty or zero limit", async () => {
    const app = makeTestApp(db).app;
    const empty = await app.request(`${ORIGIN}/api/projects/${projectId}/activity?limit=`, { headers: as(owner) });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "limit_invalid" });
    const zero = await app.request(`${ORIGIN}/api/projects/${projectId}/activity?limit=0`, { headers: as(owner) });
    expect(zero.status).toBe(400);
    expect(await zero.json()).toEqual({ error: "limit_invalid" });
  });

  it("400s an empty since_version", async () => {
    const app = makeTestApp(db).app;
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/activity?since_version=`, {
      headers: as(owner),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "since_version_invalid" });
  });
});
