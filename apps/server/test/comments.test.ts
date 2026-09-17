import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  attachFile,
  createComment,
  deleteComment,
  detachFile,
  listComments,
  mentionedUserIds,
  updateComment,
} from "../src/services/comments";
import { followerIds } from "../src/services/story-people";
import { withProject, type Actor } from "../src/db/tx";
import { activities, comments } from "../src/db/schema";
import { newId } from "../src/id";
import { makeTestDb, seedEpic, seedProject, seedStory, seedUser } from "./harness";

const uid = (a: Actor) => (a as { userId: string }).userId;

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const alice = seedUser(db, "alice@example.test");
  const carol = seedUser(db, "Carol.Smith@example.test");
  const outsider = seedUser(db, "bob@example.test");
  const projectId = seedProject(db, owner, [
    [alice, "member"],
    [carol, "member"],
  ]);
  const storyId = seedStory(db, projectId);
  return { db, owner, alice, carol, outsider, projectId, storyId };
}

function meta(storagePath = `attachments/p/${newId()}`) {
  return { id: newId(), filename: "a.txt", contentType: "text/plain", size: 5, storagePath };
}

describe("comments", () => {
  it("makes the author a follower of the story", () => {
    const { db, alice, projectId, storyId } = setup();
    withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, "hi"));
    const followers = withProject(db, alice, projectId, "story:read", (tx) => followerIds(tx, storyId));
    expect(followers).toEqual([uid(alice)]);
  });

  it("makes a mentioned member a follower, but not a mentioned non-member", () => {
    const { db, owner, alice, carol, outsider, projectId, storyId } = setup();
    withProject(db, owner, projectId, "comment:create", (tx) =>
      createComment(tx, { storyId }, "ping @alice and @carol.smith, cc @bob"),
    );
    const followers = withProject(db, owner, projectId, "story:read", (tx) => followerIds(tx, storyId));
    expect(new Set(followers)).toEqual(new Set([uid(owner), uid(alice), uid(carol)]));
    expect(followers).not.toContain(uid(outsider));
  });

  it("resolves mentions by email local part, case-insensitively, members only", () => {
    const { db, owner, alice, projectId } = setup();
    const ids = withProject(db, owner, projectId, "story:read", (tx) =>
      mentionedUserIds(tx, "@ALICE @alice @bob @nobody x@y"),
    );
    expect(ids).toEqual([uid(alice)]);
  });

  it("ignores sentence punctuation after a mention", () => {
    const { db, owner, alice, carol, projectId } = setup();
    const ids = withProject(db, owner, projectId, "story:read", (tx) =>
      mentionedUserIds(tx, "thanks @alice. and @carol.smith_ too, @- @."),
    );
    expect(ids).toEqual([uid(alice), uid(carol)]);
  });

  it("leaves an ambiguous mention unresolved", () => {
    const { db, owner, projectId } = setup();
    const twin = seedUser(db, "alice@other.example.test");
    const other = seedProject(db, owner, [[twin, "member"]]);
    const aliceTwin = seedUser(db, "ALICE@third.example.test");
    const p2 = seedProject(db, owner, [
      [twin, "member"],
      [aliceTwin, "member"],
    ]);
    expect(withProject(db, owner, other, "story:read", (tx) => mentionedUserIds(tx, "@alice"))).toEqual([uid(twin)]);
    expect(withProject(db, owner, p2, "story:read", (tx) => mentionedUserIds(tx, "@alice"))).toEqual([]);
    expect(withProject(db, owner, projectId, "story:read", (tx) => mentionedUserIds(tx, "hello"))).toEqual([]);
  });

  it("lets only the author edit", () => {
    const { db, owner, alice, projectId, storyId } = setup();
    const c = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, "a"));
    expect(() =>
      withProject(db, owner, projectId, "comment:update-own", (tx) => updateComment(tx, c.id, "b")),
    ).toThrow(/not_comment_author/);
    const edited = withProject(db, alice, projectId, "comment:update-own", (tx) => updateComment(tx, c.id, "b"));
    expect(edited.text).toBe("b");
  });

  it("writes nothing when the text is unchanged", () => {
    const { db, alice, projectId, storyId } = setup();
    const c = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, "a"));
    const before = db.select().from(activities).all().length;
    const same = withProject(db, alice, projectId, "comment:update-own", (tx) => updateComment(tx, c.id, "a"));
    expect(same.updated_at).toBe(c.updated_at);
    expect(db.select().from(activities).all().length).toBe(before);
  });

  it("lets a member delete their own comment and an owner delete anyone's", () => {
    const { db, owner, alice, carol, projectId, storyId } = setup();
    const mine = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, "a"));
    const theirs = withProject(db, carol, projectId, "comment:create", (tx) => createComment(tx, { storyId }, "c"));
    expect(() =>
      withProject(db, alice, projectId, "comment:delete", (tx) => deleteComment(tx, theirs.id)),
    ).toThrow(/forbidden/);
    withProject(db, alice, projectId, "comment:delete", (tx) => deleteComment(tx, mine.id));
    withProject(db, owner, projectId, "comment:delete", (tx) => deleteComment(tx, theirs.id));
    expect(withProject(db, owner, projectId, "story:read", (tx) => listComments(tx, { storyId }))).toEqual([]);
  });

  it("moves updated_at when an attachment is added or removed", () => {
    const { db, alice, projectId, storyId } = setup();
    const c = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, ""));
    db.update(comments).set({ updatedAt: 1 }).where(eq(comments.id, c.id)).run();
    const att = withProject(db, alice, projectId, "attachment:write", (tx) => attachFile(tx, c.id, meta()));
    const afterAdd = withProject(db, alice, projectId, "story:read", (tx) => listComments(tx, { storyId }))[0]!;
    expect(afterAdd.updated_at).toBeGreaterThan(1);
    expect(afterAdd.file_attachments.map((f) => f.id)).toEqual([att.id]);
    expect(att.download_url).toBe(`/api/projects/${projectId}/attachments/${att.id}`);

    db.update(comments).set({ updatedAt: 1 }).where(eq(comments.id, c.id)).run();
    withProject(db, alice, projectId, "attachment:delete", (tx) => detachFile(tx, att.id));
    const afterRemove = withProject(db, alice, projectId, "story:read", (tx) => listComments(tx, { storyId }))[0]!;
    expect(afterRemove.updated_at).toBeGreaterThan(1);
    expect(afterRemove.file_attachments).toEqual([]);
  });

  it("lets only the comment's author attach", () => {
    const { db, owner, alice, projectId, storyId } = setup();
    const c = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, ""));
    expect(() => withProject(db, owner, projectId, "attachment:write", (tx) => attachFile(tx, c.id, meta()))).toThrow(
      /not_comment_author/,
    );
  });

  it("lets the uploader or an owner detach, not another member", () => {
    const { db, owner, alice, carol, projectId, storyId } = setup();
    const c = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, ""));
    const a1 = withProject(db, alice, projectId, "attachment:write", (tx) => attachFile(tx, c.id, meta()));
    const a2 = withProject(db, alice, projectId, "attachment:write", (tx) => attachFile(tx, c.id, meta()));
    expect(() => withProject(db, carol, projectId, "attachment:delete", (tx) => detachFile(tx, a1.id))).toThrow(
      /forbidden/,
    );
    withProject(db, alice, projectId, "attachment:delete", (tx) => detachFile(tx, a1.id));
    withProject(db, owner, projectId, "attachment:delete", (tx) => detachFile(tx, a2.id));
  });

  it("returns the storage paths of a deleted comment's attachments", () => {
    const { db, alice, projectId, storyId } = setup();
    const c = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, "x"));
    const m1 = meta();
    const m2 = meta();
    withProject(db, alice, projectId, "attachment:write", (tx) => attachFile(tx, c.id, m1));
    withProject(db, alice, projectId, "attachment:write", (tx) => attachFile(tx, c.id, m2));
    const { storagePaths } = withProject(db, alice, projectId, "comment:delete", (tx) => deleteComment(tx, c.id));
    expect(new Set(storagePaths)).toEqual(new Set([m1.storagePath, m2.storagePath]));
  });

  it("records activity with the comment and its parent as primary resources", () => {
    const { db, alice, projectId, storyId } = setup();
    const c = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { storyId }, "x"));
    const row = db.select().from(activities).where(eq(activities.kind, "comment_create_activity")).get();
    expect(row).toBeDefined();
    const epicId = seedEpic(db, projectId, "E");
    const ec = withProject(db, alice, projectId, "comment:create", (tx) => createComment(tx, { epicId }, "on epic"));
    expect(ec.epic_id).toBe(epicId);
    expect(ec.story_id).toBeNull();
    expect(c.story_id).toBe(storyId);
  });

  it("refuses a parent in another project", () => {
    const { db, owner, projectId } = setup();
    const other = seedProject(db, owner);
    const foreign = seedStory(db, other);
    expect(() =>
      withProject(db, owner, projectId, "comment:create", (tx) => createComment(tx, { storyId: foreign }, "x")),
    ).toThrow(/not_found/);
  });
});
