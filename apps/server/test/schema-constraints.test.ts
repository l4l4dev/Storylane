import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedState, seedStory, seedUser } from "./harness";
import { newId } from "../src/id";
import { POINT_SCALES } from "../src/db/schema";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let projectId: string;
let otherProjectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = seedProject(db, owner);
  otherProjectId = seedProject(db, owner);
});

const run = (sql: string, params: unknown[] = []) => db.$client.run(sql, params as never);

describe("project_states", () => {
  it("rejects an unknown category", () => {
    expect(() =>
      run("insert into project_states (id, project_id, name, category, position, created_at) values (?,?,?,?,?,?)", [
        newId(), projectId, "Weird", "wat", 0, Date.now(),
      ]),
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects two states at the same position in one project", () => {
    seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => seedState(db, projectId, { name: "B", category: "done", position: 0 })).toThrow(/UNIQUE/);
  });

  it("allows the same position in a different project", () => {
    seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => seedState(db, otherProjectId, { name: "A", category: "unstarted", position: 0 })).not.toThrow();
  });

  it("refuses to change a state's category (guard trigger)", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => run("update project_states set category = 'done' where id = ?", [stateId])).toThrow(
      /project_states.category is immutable/,
    );
  });

  it("allows renaming a state and changing its action label", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() =>
      run("update project_states set name = 'Ready', action_label = 'Start' where id = ?", [stateId]),
    ).not.toThrow();
  });
});

describe("stories", () => {
  it("rejects a second story with the same number in one project", () => {
    seedStory(db, projectId, { title: "one" });
    expect(() =>
      run(
        "insert into stories (id, project_id, number, title, story_type, position, created_by, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)",
        [newId(), projectId, 1, "dup", "feature", 5, (owner as { userId: string }).userId, Date.now(), Date.now()],
      ),
    ).toThrow(/UNIQUE/);
  });

  it("refuses to change a story's number (guard trigger)", () => {
    const storyId = seedStory(db, projectId, { title: "one" });
    expect(() => run("update stories set number = 42 where id = ?", [storyId])).toThrow(
      /stories.number is pinned/,
    );
  });

  it("refuses a state from another project (composite FK)", () => {
    const foreignState = seedState(db, otherProjectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => seedStory(db, projectId, { stateId: foreignState })).toThrow(/FOREIGN KEY/);
  });

  it("refuses to delete a state while a story points at it (ON DELETE RESTRICT)", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    seedStory(db, projectId, { stateId });
    expect(() => run("delete from project_states where id = ?", [stateId])).toThrow(/FOREIGN KEY/);
  });

  it("rejects a negative point value and an unknown story type", () => {
    expect(() => seedStory(db, projectId, { points: -1 })).toThrow(/CHECK constraint failed/);
    expect(() => seedStory(db, projectId, { storyType: "epic" as never })).toThrow(/CHECK constraint failed/);
  });

  it("deletes its stories and states when the project goes (cascade)", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    seedStory(db, projectId, { stateId });
    run("delete from stories where project_id = ?", [projectId]);
    run("delete from projects where id = ?", [projectId]);
    expect(db.$client.query("select count(*) as c from project_states").get()).toEqual({ c: 0 });
  });
});

describe("activity_logs story guard", () => {
  it("rejects a story_id that belongs to another project (trigger)", () => {
    const foreign = seedStory(db, otherProjectId, { title: "elsewhere" });
    expect(() =>
      run("insert into activity_logs (id, project_id, story_id, action, created_at) values (?,?,?,?,?)", [
        newId(), projectId, foreign, "story.updated", Date.now(),
      ]),
    ).toThrow(/activity_logs.story_id must belong to the same project/);
  });

  it("accepts a story_id in the same project and a null story_id", () => {
    const own = seedStory(db, projectId, { title: "mine" });
    expect(() =>
      run("insert into activity_logs (id, project_id, story_id, action, created_at) values (?,?,?,?,?)", [
        newId(), projectId, own, "story.updated", Date.now(),
      ]),
    ).not.toThrow();
    expect(() =>
      run("insert into activity_logs (id, project_id, story_id, action, created_at) values (?,?,?,?,?)", [
        newId(), projectId, null, "project.updated", Date.now(),
      ]),
    ).not.toThrow();
  });
});

describe("sessions, invites, reset_tokens", () => {
  it("keeps session ids unique and cascades on user delete", () => {
    const userId = (seedUser(db, "s@example.test") as { userId: string }).userId;
    const now = Date.now();
    run("insert into sessions (id, user_id, created_at, idle_expires_at, absolute_expires_at) values (?,?,?,?,?)", [
      "hash-1", userId, now, now + 1000, now + 2000,
    ]);
    expect(() =>
      run("insert into sessions (id, user_id, created_at, idle_expires_at, absolute_expires_at) values (?,?,?,?,?)", [
        "hash-1", userId, now, now + 1000, now + 2000,
      ]),
    ).toThrow(/UNIQUE/);
    run("delete from users where id = ?", [userId]);
    expect(db.$client.query("select count(*) as c from sessions").get()).toEqual({ c: 0 });
  });

  it("keeps invite token hashes unique and restricts the role", () => {
    const createdBy = (owner as { userId: string }).userId;
    const now = Date.now();
    const insert = (role: string, hash: string) =>
      run(
        "insert into invites (id, project_id, token_hash, role, created_by, created_at, expires_at) values (?,?,?,?,?,?,?)",
        [newId(), projectId, hash, role, createdBy, now, now + 1000],
      );
    insert("member", "invite-1");
    expect(() => insert("viewer", "invite-1")).toThrow(/UNIQUE/);
    expect(() => insert("admin", "invite-2")).toThrow(/CHECK constraint failed/);
  });

  it("keeps reset token hashes unique", () => {
    const userId = (owner as { userId: string }).userId;
    const now = Date.now();
    const insert = (hash: string) =>
      run("insert into reset_tokens (id, user_id, token_hash, created_by, created_at, expires_at) values (?,?,?,?,?,?)", [
        newId(), userId, hash, userId, now, now + 1000,
      ]);
    insert("reset-1");
    expect(() => insert("reset-1")).toThrow(/UNIQUE/);
  });
});

describe("guard triggers", () => {
  it("installs every guard trigger", () => {
    const rows = db.$client
      .query("select name from sqlite_master where type = 'trigger' order by name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      "activity_logs_story_in_project_insert",
      "activity_logs_story_in_project_update",
      "project_states_category_immutable",
      "projects_point_scale_valid_insert",
      "projects_point_scale_valid_update",
      "stories_number_pinned",
      "stories_unassign_on_member_removal",
    ]);
  });
});

describe("projects.point_scale", () => {
  const insertProject = (scale: string) =>
    run("insert into projects (id, name, point_scale, created_by, created_at) values (?,?,?,?,?)", [
      newId(), "P", scale, (owner as { userId: string }).userId, Date.now(),
    ]);

  it("rejects an unknown point scale", () => {
    expect(() => insertProject("bogus")).toThrow(/projects.point_scale must be one of/);
  });

  it("accepts every scale in POINT_SCALES", () => {
    for (const scale of POINT_SCALES) expect(() => insertProject(scale)).not.toThrow();
  });

  it("refuses to update a project onto an unknown point scale", () => {
    expect(() => run("update projects set point_scale = 'bogus' where id = ?", [projectId])).toThrow(
      /projects.point_scale must be one of/,
    );
  });
});

describe("stories.assignee_id", () => {
  const assign = (storyId: string, userId: string | null) =>
    run("update stories set assignee_id = ? where id = ?", [userId, storyId]);

  it("refuses an assignee who is not a member of the story's project", () => {
    const outsider = seedUser(db, "outsider@example.test") as { userId: string };
    const storyId = seedStory(db, projectId, { title: "one" });
    expect(() => assign(storyId, outsider.userId)).toThrow(/FOREIGN KEY/);
  });

  it("accepts an assignee who is a member", () => {
    const member = seedUser(db, "member@example.test") as { userId: string };
    const withMember = seedProject(db, owner, [[{ kind: "user", userId: member.userId, isAdmin: false }, "member"]]);
    const storyId = seedStory(db, withMember, { title: "one" });
    expect(() => assign(storyId, member.userId)).not.toThrow();
  });

  it("unassigns only that project's stories when the membership row goes", () => {
    const member = seedUser(db, "leaver@example.test") as { userId: string };
    const actor = { kind: "user", userId: member.userId, isAdmin: false } as const;
    const a = seedProject(db, owner, [[actor, "member"]]);
    const b = seedProject(db, owner, [[actor, "member"]]);
    const inA = seedStory(db, a, { title: "in a" });
    const inB = seedStory(db, b, { title: "in b" });
    assign(inA, member.userId);
    assign(inB, member.userId);
    run("delete from project_members where project_id = ? and user_id = ?", [a, member.userId]);
    const assigneeOf = (id: string) =>
      (db.$client.query("select assignee_id as a from stories where id = ?").get(id) as { a: string | null }).a;
    expect(assigneeOf(inA)).toBeNull();
    expect(assigneeOf(inB)).toBe(member.userId);
  });
});
