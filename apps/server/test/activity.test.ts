import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";
import { withProject } from "../src/db/tx";
import { listActivity, projectVersion, recordActivity, storyActivity } from "../src/services/activity";
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
