import { describe, expect, it } from "bun:test";
import { listActivity, storyActivity } from "../src/services/activity";
import { createStory, deleteStory, listStories, readStory, updateStory } from "../src/services/stories";
import { withProject } from "../src/db/tx";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = seedProject(db, owner);
  return { db, owner, projectId };
}

describe("createStory", () => {
  it("assigns sequential numbers, lands in the Icebox unscheduled, and sets requested_by_id", () => {
    const { db, owner, projectId } = setup();
    const first = withProject(db, owner, projectId, "story:write", (tx) => createStory(tx, { name: "First" }));
    const second = withProject(db, owner, projectId, "story:write", (tx) => createStory(tx, { name: "Second" }));
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(first.list).toBe("icebox");
    expect(first.current_state).toBe("unscheduled");
    expect(first.requested_by_id).toBe(owner.kind === "user" ? owner.userId : null);
  });

  it("lands in the backlog list when created unstarted", () => {
    const { db, owner, projectId } = setup();
    const story = withProject(db, owner, projectId, "story:write", (tx) =>
      createStory(tx, { name: "Started", current_state: "unstarted" }),
    );
    expect(story.list).toBe("backlog");
  });
});

describe("updateStory", () => {
  it("refuses an estimate off the project's scale", () => {
    const { db, owner, projectId } = setup();
    const id = seedStory(db, projectId);
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, id, { estimate: 7 })),
    ).toThrow(expect.objectContaining({ status: 400, code: "points_off_scale" }));
  });

  it("refuses an invalid transition", () => {
    const { db, owner, projectId } = setup();
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, id, { current_state: "delivered" })),
    ).toThrow(expect.objectContaining({ status: 409, code: "invalid_transition" }));
  });

  it("blocks starting an unestimated feature but not an unestimated chore", () => {
    const { db, owner, projectId } = setup();
    const feature = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", storyType: "feature" });
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, feature, { current_state: "started" })),
    ).toThrow(expect.objectContaining({ status: 409, code: "estimate_required" }));

    const chore = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", storyType: "chore" });
    const started = withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, chore, { current_state: "started" }),
    );
    expect(started.current_state).toBe("started");
  });

  it("sets accepted_at on accept, clears it on re-open, and refuses any other move out of accepted", () => {
    const { db, owner, projectId } = setup();
    const id = seedStory(db, projectId, {
      list: "backlog",
      currentState: "started",
      storyType: "chore",
      estimate: null,
    });
    const accepted = withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, id, { current_state: "accepted" }),
    );
    expect(accepted.accepted_at).not.toBeNull();
    expect(accepted.list).toBe("backlog");

    const reopened = withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, id, { current_state: "unstarted" }),
    );
    expect(reopened.accepted_at).toBeNull();

    const acceptedAgain = withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, id, { current_state: "started" }),
    );
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, acceptedAgain.id, { current_state: "accepted" }));
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, id, { current_state: "started" })),
    ).toThrow(expect.objectContaining({ status: 409, code: "invalid_transition" }));
  });

  it("moves a story to the end of the Icebox when set to unscheduled", () => {
    const { db, owner, projectId } = setup();
    seedStory(db, projectId, { list: "icebox", currentState: "unscheduled" });
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const moved = withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, id, { current_state: "unscheduled" }),
    );
    expect(moved.list).toBe("icebox");
    const rows = withProject(db, owner, projectId, "story:read", (tx) => listStories(tx));
    const icebox = rows.filter((r) => r.list === "icebox").sort((a, b) => a.position - b.position);
    expect(icebox[icebox.length - 1]!.id).toBe(id);
  });

  it("writes exactly one activity row per mutation, readable via storyActivity", () => {
    const { db, owner, projectId } = setup();
    const created = withProject(db, owner, projectId, "story:write", (tx) => createStory(tx, { name: "Tracked" }));
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, created.id, { name: "Renamed" }));
    const activity = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, created.id));
    expect(activity).toHaveLength(2);
    expect(activity[0]!.kind).toBe("story_update_activity");
    expect(activity[1]!.kind).toBe("story_create_activity");
  });
});

describe("deleteStory", () => {
  it("removes the row but leaves its activity history in place, unlinked from the gone story", () => {
    const { db, owner, projectId } = setup();
    const created = withProject(db, owner, projectId, "story:write", (tx) => createStory(tx, { name: "Gone" }));
    withProject(db, owner, projectId, "story:write", (tx) => deleteStory(tx, created.id));
    expect(() => withProject(db, owner, projectId, "story:read", (tx) => readStory(tx, created.id))).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    const activity = withProject(db, owner, projectId, "story:read", (tx) => listActivity(tx, {}));
    expect(activity.some((a) => a.kind === "story_delete_activity")).toBe(true);
    // No primary_resources entry names the gone story: storyActivity must not find it.
    const perStory = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, created.id));
    expect(perStory.some((a) => a.kind === "story_delete_activity")).toBe(false);
  });
});

describe("listStories", () => {
  it("filters by withState and withStoryType", () => {
    const { db, owner, projectId } = setup();
    seedStory(db, projectId, { currentState: "unscheduled", storyType: "feature" });
    seedStory(db, projectId, { list: "backlog", currentState: "unstarted", storyType: "chore" });
    const unscheduled = withProject(db, owner, projectId, "story:read", (tx) =>
      listStories(tx, { withState: ["unscheduled"] }),
    );
    expect(unscheduled).toHaveLength(1);
    expect(unscheduled[0]!.current_state).toBe("unscheduled");

    const chores = withProject(db, owner, projectId, "story:read", (tx) => listStories(tx, { withStoryType: ["chore"] }));
    expect(chores).toHaveLength(1);
    expect(chores[0]!.story_type).toBe("chore");
  });
});
