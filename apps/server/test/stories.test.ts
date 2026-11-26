import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { projects } from "../src/db/schema";
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

  it("refuses a deadline on a non-release", () => {
    const { db, owner, projectId } = setup();
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) =>
        createStory(tx, { name: "Feature with deadline", story_type: "feature", deadline: Date.now() }),
      ),
    ).toThrow(expect.objectContaining({ status: 400, code: "deadline_release_only" }));
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

  it("allows setting story_type and deadline together in one PUT", () => {
    const { db, owner, projectId } = setup();
    const id = seedStory(db, projectId, { storyType: "feature" });
    const deadline = Date.now();
    const updated = withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, id, { story_type: "release", deadline }),
    );
    expect(updated.story_type).toBe("release");
    expect(updated.deadline).toBe(deadline);
  });

  it("clears the deadline automatically when a release is changed to another type", () => {
    const { db, owner, projectId } = setup();
    const deadline = Date.now();
    const id = seedStory(db, projectId, { storyType: "release" });
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, id, { deadline }));
    const updated = withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, id, { story_type: "feature" }),
    );
    expect(updated.story_type).toBe("feature");
    expect(updated.deadline).toBeNull();
  });

  it("refuses a deadline that requires the pre-patch type to be release", () => {
    const { db, owner, projectId } = setup();
    const id = seedStory(db, projectId, { storyType: "feature" });
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, id, { deadline: Date.now() })),
    ).toThrow(expect.objectContaining({ status: 400, code: "deadline_release_only" }));
  });

  it("404s on an unknown story id", () => {
    const { db, owner, projectId } = setup();
    expect(() =>
      withProject(db, owner, projectId, "story:read", (tx) => readStory(tx, "no-such-story")),
    ).toThrow(expect.objectContaining({ status: 404, code: "not_found" }));
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, "no-such-story", { name: "x" })),
    ).toThrow(expect.objectContaining({ status: 404, code: "not_found" }));
  });

  it("404s on a story from another project", () => {
    const { db, owner, projectId } = setup();
    const otherProjectId = seedProject(db, owner);
    const foreignId = seedStory(db, otherProjectId);
    expect(() =>
      withProject(db, owner, projectId, "story:read", (tx) => readStory(tx, foreignId)),
    ).toThrow(expect.objectContaining({ status: 404, code: "not_found" }));
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, foreignId, { name: "x" })),
    ).toThrow(expect.objectContaining({ status: 404, code: "not_found" }));
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

/** Current only exists as a hand-placed panel while planning is manual (Assumption 7). */
function useManualPlanning(db: ReturnType<typeof makeTestDb>, projectId: string): void {
  db.update(projects).set({ automaticPlanning: false }).where(eq(projects.id, projectId)).run();
}

describe("updateStory moves", () => {
  it("drops a story into Current after the last story already there", () => {
    const { db, owner, projectId } = setup();
    useManualPlanning(db, projectId);
    const planned = seedStory(db, projectId, { list: "backlog", currentState: "planned" });
    const u1 = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const u2 = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const x = seedStory(db, projectId);
    const moved = withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, x, { group: "current" }));
    expect(moved.current_state).toBe("planned");
    const rows = withProject(db, owner, projectId, "story:read", (tx) => listStories(tx));
    const backlog = rows.filter((r) => r.list === "backlog").sort((a, b) => a.position - b.position);
    expect(backlog.map((r) => r.id)).toEqual([planned, x, u1, u2]);
  });

  it("drops a story into an empty Current at the head of the backlog", () => {
    const { db, owner, projectId } = setup();
    useManualPlanning(db, projectId);
    const u1 = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const u2 = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    const x = seedStory(db, projectId);
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, x, { group: "current" }));
    const rows = withProject(db, owner, projectId, "story:read", (tx) => listStories(tx));
    const backlog = rows.filter((r) => r.list === "backlog").sort((a, b) => a.position - b.position);
    expect(backlog.map((r) => r.id)).toEqual([x, u1, u2]);
  });

  it("writes one update activity and one move activity for a patch that edits and moves", () => {
    const { db, owner, projectId } = setup();
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const c = seedStory(db, projectId);
    withProject(db, owner, projectId, "story:write", (tx) =>
      updateStory(tx, c, { name: "Edited and moved", after_id: a, before_id: b }),
    );
    const kinds = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, c)).map((a2) => a2.kind);
    expect(kinds.filter((k) => k === "story_update_activity")).toHaveLength(1);
    expect(kinds.filter((k) => k === "story_move_activity")).toHaveLength(1);
  });

  it("writes no move activity when the drop resolves to where the story already is", () => {
    const { db, owner, projectId } = setup();
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, b, { after_id: a }));
    const kinds = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, b)).map((a2) => a2.kind);
    expect(kinds.filter((k) => k === "story_move_activity")).toHaveLength(0);
  });

  it("refuses group: unscheduled on a started story", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId, { list: "backlog", currentState: "started", estimate: 1 });
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, storyId, { group: "unscheduled" })),
    ).toThrow(expect.objectContaining({ status: 409, code: "invalid_transition" }));
  });
});
