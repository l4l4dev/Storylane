import { describe, expect, it } from "bun:test";
import { withProject } from "../src/db/tx";
import { storyActivity } from "../src/services/activity";
import { addFollower, addOwner, removeFollower, removeOwner } from "../src/services/story-people";
import { readStory, updateStory } from "../src/services/stories";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";

const db = makeTestDb();
const owner = seedUser(db, "owner@example.test");
const member = seedUser(db, "member@example.test");
const viewer = seedUser(db, "viewer@example.test");
const projectId = seedProject(db, owner, [
  [member, "member"],
  [viewer, "viewer"],
]);

describe("story owners and followers", () => {
  it("adds the clicker as an owner when a story starts", () => {
    const storyId = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 1 });
    const story = withProject(db, member, projectId, "story:write", (tx) =>
      updateStory(tx, storyId, { current_state: "started" }),
    );
    expect(story.owner_ids).toEqual([(member as { userId: string }).userId]);
  });

  it("refuses an owner who is not a member of the project", () => {
    const outsider = seedUser(db, "outsider@example.test") as { userId: string };
    const storyId = seedStory(db, projectId);
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, outsider.userId)),
    ).toThrow(/owner_not_member/);
  });

  it("is idempotent in both directions", () => {
    const storyId = seedStory(db, projectId);
    const id = (owner as { userId: string }).userId;
    withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
    const twice = withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
    expect(twice).toEqual([id]);
    withProject(db, owner, projectId, "story:write", (tx) => removeOwner(tx, storyId, id));
    const gone = withProject(db, owner, projectId, "story:write", (tx) => removeOwner(tx, storyId, id));
    expect(gone).toEqual([]);
  });

  it("makes an owner a follower but not the other way round", () => {
    const storyId = seedStory(db, projectId);
    const id = (owner as { userId: string }).userId;
    withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
    expect(withProject(db, owner, projectId, "story:read", (tx) => readStory(tx, storyId)).follower_ids).toEqual([id]);
    withProject(db, owner, projectId, "follower:write", (tx) => removeFollower(tx, storyId, id));
    expect(withProject(db, owner, projectId, "story:read", (tx) => readStory(tx, storyId)).owner_ids).toEqual([id]);
  });

  it("does not record activity or original/new_values mismatch on a no-op remove", () => {
    const storyId = seedStory(db, projectId);
    const id = (owner as { userId: string }).userId;
    withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
    const before = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, storyId)).length;
    // Owner is already an owner/follower of itself's own add above; remove a user who was never
    // a follower at all, twice, so the second call is the no-op under test.
    withProject(db, owner, projectId, "follower:write", (tx) => removeFollower(tx, storyId, id));
    const afterFirstRemove = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, storyId)).length;
    withProject(db, owner, projectId, "follower:write", (tx) => removeFollower(tx, storyId, id));
    const afterSecondRemove = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, storyId)).length;
    expect(afterFirstRemove).toBe(before + 1);
    expect(afterSecondRemove).toBe(afterFirstRemove);
  });

  it("records original_values alongside new_values for an owner change", () => {
    const storyId = seedStory(db, projectId);
    const id = (owner as { userId: string }).userId;
    withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
    const entries = withProject(db, owner, projectId, "story:read", (tx) => storyActivity(tx, storyId));
    const change = entries[0]!.changes[0]!;
    expect(change.original_values).toEqual({ owner_ids: [] });
    expect(change.new_values).toEqual({ owner_ids: [id] });
  });

  it("lets a viewer follow only itself", () => {
    const storyId = seedStory(db, projectId);
    const viewerId = (viewer as { userId: string }).userId;
    expect(() =>
      withProject(db, viewer, projectId, "follower:write", (tx) => addFollower(tx, storyId, viewerId)),
    ).not.toThrow();
    expect(() =>
      withProject(db, viewer, projectId, "follower:write", (tx) => addFollower(tx, storyId, (owner as { userId: string }).userId)),
    ).toThrow(/forbidden/);
  });
});
