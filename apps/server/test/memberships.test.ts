import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestApp, makeTestDb, seedProject, seedStory, seedUser } from "./harness";
import { changeRole, leaveProject, listMemberships, removeMember } from "../src/services/memberships";
import { withProject, type Actor } from "../src/db/tx";
import { HttpError } from "../src/http-error";
import { storyOwners, storyFollowers } from "../src/db/schema";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let member: Actor;
let viewer: Actor;
let projectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
  viewer = seedUser(db, "viewer@example.test");
  projectId = seedProject(db, owner, [
    [member, "member"],
    [viewer, "viewer"],
  ]);
});

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

describe("listMemberships", () => {
  it("lets a viewer list every member", () => {
    const rows = withProject(db, viewer, projectId, "member:read", (tx) => listMemberships(tx));
    expect(rows.map((r) => r.role).sort()).toEqual(["member", "owner", "viewer"]);
  });
});

describe("changeRole", () => {
  it("changes a member's role", () => {
    const row = withProject(db, owner, projectId, "member:change-role", (tx) =>
      changeRole(tx, (member as { userId: string }).userId, "viewer"),
    );
    expect(row.role).toBe("viewer");
  });

  it("promotes a member to owner, leaving the project with two owners", async () => {
    const res = await makeTestApp(db).app.request(`/api/projects/${projectId}/memberships/${(member as { userId: string }).userId}`, {
      method: "PUT",
      headers: { "x-test-actor": JSON.stringify(owner), "content-type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    });
    expect(res.status).toBe(200);
    const rows = withProject(db, owner, projectId, "member:read", (tx) => listMemberships(tx));
    expect(rows.filter((r) => r.role === "owner")).toHaveLength(2);
  });

  it("answers 409 last_owner through the route when the sole owner demotes themselves", async () => {
    const res = await makeTestApp(db).app.request(`/api/projects/${projectId}/memberships/${(owner as { userId: string }).userId}`, {
      method: "PUT",
      headers: { "x-test-actor": JSON.stringify(owner), "content-type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_owner" });
  });

  it("answers 404 for a non-member before validating the role", async () => {
    const outsider = seedUser(db, "outsider@example.test");
    const res = await makeTestApp(db).app.request(`/api/projects/${projectId}/memberships/${(outsider as { userId: string }).userId}`, {
      method: "PUT",
      headers: { "x-test-actor": JSON.stringify(owner), "content-type": "application/json" },
      body: JSON.stringify({ role: "bogus" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("refuses to demote the sole owner with 409 last_owner", () => {
    expect(
      status(() =>
        withProject(db, owner, projectId, "member:change-role", (tx) =>
          changeRole(tx, (owner as { userId: string }).userId, "member"),
        ),
      ),
    ).toBe(409);
  });
});

describe("removeMember", () => {
  it("answers 403 forbidden when an owner names their own id, even as the sole owner", () => {
    expect(
      status(() =>
        withProject(db, owner, projectId, "member:remove", (tx) => removeMember(tx, (owner as { userId: string }).userId)),
      ),
    ).toBe(403);
  });

  it("answers 403 forbidden through the route when a co-owner removes themselves", async () => {
    withProject(db, owner, projectId, "member:change-role", (tx) =>
      changeRole(tx, (member as { userId: string }).userId, "owner"),
    );
    const res = await makeTestApp(db).app.request(`/api/projects/${projectId}/memberships/${(owner as { userId: string }).userId}`, {
      method: "DELETE",
      headers: { "x-test-actor": JSON.stringify(owner), "content-type": "application/json" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("drops the removed member's story owner/follower rows (member removal trigger)", () => {
    const memberUserId = (member as { userId: string }).userId;
    const storyId = seedStory(db, projectId, { list: "backlog" });
    db.insert(storyOwners).values({ projectId, storyId, userId: memberUserId, addedAt: Date.now() }).run();
    db.insert(storyFollowers).values({ projectId, storyId, userId: memberUserId, followedAt: Date.now() }).run();

    withProject(db, owner, projectId, "member:remove", (tx) => removeMember(tx, memberUserId));

    expect(db.select().from(storyOwners).where(eq(storyOwners.userId, memberUserId)).all()).toEqual([]);
    expect(db.select().from(storyFollowers).where(eq(storyFollowers.userId, memberUserId)).all()).toEqual([]);
  });
});

describe("leaveProject", () => {
  it("removes the actor's own membership", () => {
    withProject(db, member, projectId, "member:leave", (tx) => leaveProject(tx));
    const rows = withProject(db, owner, projectId, "member:read", (tx) => listMemberships(tx));
    expect(rows.some((r) => r.user_id === (member as { userId: string }).userId)).toBe(false);
  });
});
