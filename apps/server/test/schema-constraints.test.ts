import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedUser } from "./harness";
import { newId } from "../src/id";
import { POINT_SCALES } from "../src/db/schema";
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

const run = (sql: string, params: unknown[] = []) => db.$client.run(sql, params as never);

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

