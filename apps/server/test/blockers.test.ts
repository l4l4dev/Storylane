import { describe, expect, it } from "bun:test";
import { createBlocker, deleteBlocker, listBlockers, updateBlocker } from "../src/services/blockers";
import { deleteStory, updateStory } from "../src/services/stories";
import { storyActivity } from "../src/services/activity";
import { withProject } from "../src/db/tx";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = seedProject(db, owner);
  return { db, owner, projectId };
}

describe("createBlocker / listBlockers / updateBlocker / deleteBlocker", () => {
  it("links a blocker to the story its description names", () => {
    const { db, owner, projectId } = setup();
    const blocked = seedStory(db, projectId, { name: "blocked" });
    const blocking = seedStory(db, projectId, { name: "blocking", list: "backlog", currentState: "unstarted", estimate: 1 });
    const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
      createBlocker(tx, blocked, `waiting on #${number.number}`),
    );
    expect(blocker.blocking_story_id).toBe(blocking);
    expect(blocker.resolved).toBe(false);
  });

  it("leaves free text unlinked", () => {
    const { db, owner, projectId } = setup();
    const blocked = seedStory(db, projectId);
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
      createBlocker(tx, blocked, "waiting on the vendor"),
    );
    expect(blocker.blocking_story_id).toBeNull();
  });

  it("ignores a #n from another project", () => {
    const { db, owner, projectId } = setup();
    const other = seedProject(db, owner);
    seedStory(db, other, { name: "theirs" });
    const blocked = seedStory(db, projectId);
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) => createBlocker(tx, blocked, "blocked by #1"));
    // #1 in *this* project is the blocked story itself, and a blocker may not name its own story.
    expect(blocker.blocking_story_id).toBeNull();
  });

  it("resolves automatically when the referenced story is accepted", () => {
    const { db, owner, projectId } = setup();
    const blocking = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
    const blocked = seedStory(db, projectId);
    const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
      createBlocker(tx, blocked, `#${number.number}`),
    );
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, blocking, { current_state: "accepted" }));
    const after = withProject(db, owner, projectId, "story:read", (tx) => listBlockers(tx, blocked));
    expect(after.find((b) => b.id === blocker.id)!.resolved).toBe(true);
  });

  it("resolves when the referenced story is deleted", () => {
    const { db, owner, projectId } = setup();
    const blocking = seedStory(db, projectId);
    const blocked = seedStory(db, projectId);
    const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
    withProject(db, owner, projectId, "blocker:write", (tx) => createBlocker(tx, blocked, `#${number.number}`));
    withProject(db, owner, projectId, "story:delete", (tx) => deleteStory(tx, blocking));
    const after = withProject(db, owner, projectId, "story:read", (tx) => listBlockers(tx, blocked));
    expect(after[0]!.resolved).toBe(true);
    expect(after[0]!.blocking_story_id).toBeNull();
    const activity = withProject(db, owner, projectId, "activity:read", (tx) => storyActivity(tx, blocked));
    expect(activity.filter((a) => a.kind === "blocker_update_activity")).toHaveLength(1);
  });

  it("leaves resolved blockers resolved when the accepted story is reopened", () => {
    const { db, owner, projectId } = setup();
    const blocking = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
    const blocked = seedStory(db, projectId);
    const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
      createBlocker(tx, blocked, `#${number.number}`),
    );
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, blocking, { current_state: "accepted" }));
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, blocking, { current_state: "unstarted" }));
    const after = withProject(db, owner, projectId, "story:read", (tx) => listBlockers(tx, blocked));
    expect(after.find((b) => b.id === blocker.id)!.resolved).toBe(true);
  });

  it("creates a blocker already resolved when #n names an already-accepted story", () => {
    const { db, owner, projectId } = setup();
    const blocking = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, blocking, { current_state: "accepted" }));
    const blocked = seedStory(db, projectId);
    const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
      createBlocker(tx, blocked, `#${number.number}`),
    );
    expect(blocker.blocking_story_id).toBe(blocking);
    expect(blocker.resolved).toBe(true);
    const activity = withProject(db, owner, projectId, "activity:read", (tx) => storyActivity(tx, blocked));
    expect(activity.filter((a) => a.kind === "blocker_update_activity")).toHaveLength(0);
  });

  it("re-resolves blocking_story_id when the description changes", () => {
    const { db, owner, projectId } = setup();
    const blockedTarget = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, blockedTarget, { current_state: "accepted" }));
    const blocked = seedStory(db, projectId);
    const targetNumber = db.$client.query("select number from stories where id = ?").get(blockedTarget) as { number: number };
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) => createBlocker(tx, blocked, "free text"));
    expect(blocker.blocking_story_id).toBeNull();
    const updated = withProject(db, owner, projectId, "blocker:write", (tx) =>
      updateBlocker(tx, blocker.id, { description: `now #${targetNumber.number}` }),
    );
    expect(updated.blocking_story_id).toBe(blockedTarget);
    expect(updated.resolved).toBe(true);
  });

  it("writes no update or activity for a no-op update", () => {
    const { db, owner, projectId } = setup();
    const blocked = seedStory(db, projectId);
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) => createBlocker(tx, blocked, "free text"));
    const before = withProject(db, owner, projectId, "activity:read", (tx) => storyActivity(tx, blocked)).length;
    const updated = withProject(db, owner, projectId, "blocker:write", (tx) =>
      updateBlocker(tx, blocker.id, { description: "free text" }),
    );
    expect(updated.updated_at).toBe(blocker.updated_at);
    const after = withProject(db, owner, projectId, "activity:read", (tx) => storyActivity(tx, blocked)).length;
    expect(after).toBe(before);
  });

  it("re-opens a resolved blocker on an explicit resolved: false, even if its target is accepted", () => {
    const { db, owner, projectId } = setup();
    const blocking = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, blocking, { current_state: "accepted" }));
    const blocked = seedStory(db, projectId);
    const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
      createBlocker(tx, blocked, `#${number.number}`),
    );
    expect(blocker.resolved).toBe(true);
    const reopened = withProject(db, owner, projectId, "blocker:write", (tx) => updateBlocker(tx, blocker.id, { resolved: false }));
    expect(reopened.resolved).toBe(false);
  });

  it("deletes a blocker", () => {
    const { db, owner, projectId } = setup();
    const blocked = seedStory(db, projectId);
    const blocker = withProject(db, owner, projectId, "blocker:write", (tx) => createBlocker(tx, blocked, "free text"));
    withProject(db, owner, projectId, "blocker:write", (tx) => deleteBlocker(tx, blocker.id));
    const after = withProject(db, owner, projectId, "story:read", (tx) => listBlockers(tx, blocked));
    expect(after).toHaveLength(0);
  });
});
