import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, seedProject, seedUser } from "./harness";
import { withProject, type Actor } from "../src/db/tx";
import { activityLogs, projects } from "../src/db/schema";
import { recordActivity } from "../src/services/activity";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let projectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = seedProject(db, owner);
});

const rows = () => db.select().from(activityLogs).all();

describe("recordActivity", () => {
  it("writes project id, actor, action and JSON payload", () => {
    withProject(db, owner, projectId, "project:update", (tx) => {
      db.$client.run("update projects set name = 'renamed' where id = ?", [tx.projectId]);
      recordActivity(tx, { action: "project.updated", payload: { name: { from: "P", to: "renamed" } } });
    });
    const [row] = rows();
    expect(row!.projectId).toBe(projectId);
    expect(row!.actorId).toBe(owner.kind === "user" ? owner.userId : null);
    expect(row!.action).toBe("project.updated");
    expect(JSON.parse(row!.payload!)).toEqual({ name: { from: "P", to: "renamed" } });
    expect(row!.storyId).toBeNull();
    expect(row!.createdAt).toBeGreaterThan(0);
  });

  it("commits the change and its activity row together", () => {
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => {
        tx.tx.update(projects).set({ name: "half-written" }).where(eq(projects.id, tx.projectId)).run();
        recordActivity(tx, { action: "project.updated", payload: null });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(rows()).toHaveLength(0);
    expect(db.select().from(projects).where(eq(projects.id, projectId)).get()!.name).toBe("P");
  });

  it("rejects an action name that is not in the vocabulary", () => {
    withProject(db, owner, projectId, "project:read", (tx) => {
      // @ts-expect-error not an ActivityAction
      expect(() => recordActivity(tx, { action: "story.exploded" })).toThrow(/unknown activity action/);
    });
  });
});
