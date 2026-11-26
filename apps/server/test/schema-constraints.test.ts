import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedLabel, seedProject, seedStory, seedUser } from "./harness";
import { newId } from "../src/id";
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

describe("projects", () => {
  it("rejects a start date that is not the week start day", () => {
    expect(() =>
      run("update projects set start_date = '2026-09-15' where id = ?", [projectId]),
    ).toThrow(/start_date must fall on week_start_day/);
  });

  it("accepts a start date on the configured week start day", () => {
    expect(() =>
      run("update projects set start_date = '2026-09-13', week_start_day = 7 where id = ?", [projectId]),
    ).not.toThrow();
  });

  it("rejects a start date that is not a calendar date", () => {
    for (const value of ["bogus", "2026-9-4", "2026-02-30", ""]) {
      expect(() => run("update projects set start_date = ? where id = ?", [value, projectId])).toThrow(
        /start_date must be a YYYY-MM-DD calendar date/,
      );
    }
  });

  it("rejects a malformed start date on insert", () => {
    const userId = (owner as { userId: string }).userId;
    expect(() =>
      run("insert into projects (id, name, start_date, created_by, created_at) values (?,?,?,?,?)", [
        newId(), "P", "2026-9-4", userId, Date.now(),
      ]),
    ).toThrow(/start_date must be a YYYY-MM-DD calendar date/);
  });

  it("rejects an iteration length outside 1-4", () => {
    expect(() => run("update projects set iteration_length = 5 where id = ?", [projectId])).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("rejects a velocity strategy outside 1-4", () => {
    expect(() => run("update projects set velocity_averaged_over = 0 where id = ?", [projectId])).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("refuses to turn bug and chore estimation back off", () => {
    run("update projects set bugs_and_chores_are_estimatable = 1 where id = ?", [projectId]);
    expect(() =>
      run("update projects set bugs_and_chores_are_estimatable = 0 where id = ?", [projectId]),
    ).toThrow(/cannot be turned off again/);
  });

  it("refuses to re-enable automatic planning while a planned story exists", () => {
    run("update projects set automatic_planning = 0 where id = ?", [projectId]);
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    run("update stories set current_state = 'planned' where id = ?", [id]);
    expect(() => run("update projects set automatic_planning = 1 where id = ?", [projectId])).toThrow(
      /leaves no planned story behind/,
    );
  });
});

describe("stories", () => {
  it("rejects a second story with the same number in one project", () => {
    seedStory(db, projectId);
    expect(() =>
      run(
        "insert into stories (id, project_id, number, name, story_type, current_state, list, position, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)",
        [newId(), projectId, 1, "dup", "feature", "unscheduled", "icebox", 99, Date.now(), Date.now()],
      ),
    ).toThrow(/UNIQUE/);
  });

  it("rejects two stories at the same position in one list", () => {
    seedStory(db, projectId, { position: 1024 });
    expect(() => seedStory(db, projectId, { position: 1024 })).toThrow(/UNIQUE/);
  });

  it("allows the same position in the other list", () => {
    seedStory(db, projectId, { list: "icebox", position: 1024 });
    expect(() => seedStory(db, projectId, { list: "backlog", position: 1024 })).not.toThrow();
  });

  it("rejects an unknown state", () => {
    // list "backlog": an icebox insert would trip stories_icebox_is_unscheduled_insert first,
    // since SQLite runs BEFORE triggers ahead of CHECK evaluation.
    expect(() => seedStory(db, projectId, { list: "backlog", currentState: "done" as never })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("refuses to renumber a story", () => {
    const id = seedStory(db, projectId);
    expect(() => run("update stories set number = 42 where id = ?", [id])).toThrow(/number is pinned/);
  });

  it("refuses to move a story to another project", () => {
    const id = seedStory(db, projectId);
    expect(() => run("update stories set project_id = ? where id = ?", [otherProjectId, id])).toThrow(
      /number is pinned/,
    );
  });

  it("keeps unscheduled and the icebox in agreement", () => {
    const id = seedStory(db, projectId, { list: "icebox" });
    expect(() => run("update stories set list = 'backlog' where id = ?", [id])).toThrow(
      /unscheduled is exactly the icebox list/,
    );
  });

  it("refuses a started release and a finished chore", () => {
    const release = seedStory(db, projectId, { list: "backlog", storyType: "release", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [release])).toThrow(
      /a release goes unstarted -> finished -> accepted/,
    );
    const chore = seedStory(db, projectId, { list: "backlog", storyType: "chore", currentState: "started" });
    expect(() => run("update stories set current_state = 'finished' where id = ?", [chore])).toThrow(
      /a chore unstarted -> started -> accepted/,
    );
  });

  it("refuses to deliver a release or a chore", () => {
    const release = seedStory(db, projectId, { list: "backlog", storyType: "release", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'delivered' where id = ?", [release])).toThrow(
      /a release goes unstarted -> finished -> accepted/,
    );
    const chore = seedStory(db, projectId, { list: "backlog", storyType: "chore", currentState: "started" });
    expect(() => run("update stories set current_state = 'delivered' where id = ?", [chore])).toThrow(
      /a chore unstarted -> started -> accepted/,
    );
  });

  it("refuses to estimate a release", () => {
    const release = seedStory(db, projectId, { list: "backlog", storyType: "release", currentState: "unstarted" });
    expect(() => run("update stories set estimate = 2 where id = ?", [release])).toThrow(
      /a release is never estimated/,
    );
  });

  it("refuses to start an unestimated feature but allows an unestimated chore", () => {
    const feature = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [feature])).toThrow(
      /must be estimated before it starts/,
    );
    const chore = seedStory(db, projectId, { list: "backlog", storyType: "chore", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [chore])).not.toThrow();
  });

  it("gates bugs and chores once the project enables their estimation", () => {
    run("update projects set bugs_and_chores_are_estimatable = 1 where id = ?", [projectId]);
    const bug = seedStory(db, projectId, { list: "backlog", storyType: "bug", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [bug])).toThrow(
      /must be estimated before it starts/,
    );
  });

  it("ties accepted_at to the accepted state in both directions", () => {
    const id = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
    expect(() => run("update stories set current_state = 'accepted' where id = ?", [id])).toThrow(
      /accepted_at is set exactly while/,
    );
    expect(() =>
      run("update stories set current_state = 'accepted', accepted_at = ? where id = ?", [Date.now(), id]),
    ).not.toThrow();
  });

  it("refuses planned while automatic planning is on, and allows it once off", () => {
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'planned' where id = ?", [id])).toThrow(
      /planned exists only under manual planning/,
    );
    run("update projects set automatic_planning = 0 where id = ?", [projectId]);
    expect(() => run("update stories set current_state = 'planned' where id = ?", [id])).not.toThrow();
  });

  it("refuses a deadline on a non-release story", () => {
    const id = seedStory(db, projectId);
    expect(() => run("update stories set deadline = ? where id = ?", [Date.now(), id])).toThrow(
      /deadline belongs to release stories only/,
    );
  });
});

describe("cross-project composite keys", () => {
  it("refuses to label a story with another project's label", () => {
    const storyId = seedStory(db, projectId);
    const foreignLabel = seedLabel(db, otherProjectId, "elsewhere");
    expect(() =>
      run("insert into story_labels (project_id, story_id, label_id, added_at) values (?,?,?,?)", [
        projectId, storyId, foreignLabel, Date.now(),
      ]),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("refuses an owner who is not a member of the story's project", () => {
    const storyId = seedStory(db, projectId);
    const outsider = seedUser(db, "outsider@example.test") as { userId: string };
    expect(() =>
      run("insert into story_owners (project_id, story_id, user_id, added_at) values (?,?,?,?)", [
        projectId, storyId, outsider.userId, Date.now(),
      ]),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("drops owners and follows when a membership is removed", () => {
    const member = seedUser(db, "member@example.test") as { userId: string };
    run("insert into project_members (project_id, user_id, role, favorite, joined_at) values (?,?,?,?,?)", [
      projectId, member.userId, "member", 0, Date.now(),
    ]);
    const storyId = seedStory(db, projectId);
    run("insert into story_owners (project_id, story_id, user_id, added_at) values (?,?,?,?)", [
      projectId, storyId, member.userId, Date.now(),
    ]);
    run("delete from project_members where project_id = ? and user_id = ?", [projectId, member.userId]);
    const left = db.$client.query("select count(*) as n from story_owners").get() as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("blockers", () => {
  it("unlinks and resolves a blocker when the story it names is deleted", () => {
    const blocked = seedStory(db, projectId);
    const blocking = seedStory(db, projectId);
    const blockerId = newId();
    const reporter = seedUser(db, "blocker-reporter@example.test") as { userId: string };
    run(
      "insert into blockers (id, project_id, story_id, blocking_story_id, description, resolved, person_id, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)",
      [blockerId, projectId, blocked, blocking, "waiting", 0, reporter.userId, Date.now(), Date.now()],
    );
    run("delete from stories where id = ?", [blocking]);
    const row = db.$client
      .query("select blocking_story_id as b, resolved as r from blockers where id = ?")
      .get(blockerId) as { b: string | null; r: number };
    expect(row.b).toBeNull();
    expect(row.r).toBe(1);
  });
});

describe("iteration_overrides", () => {
  it("rejects an override length outside 1-99", () => {
    expect(() =>
      run("insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)", [
        projectId, 3, 100, 1, Date.now(), Date.now(),
      ]),
    ).toThrow(/CHECK constraint failed/);
  });

  it("keeps one override row per (project, number)", () => {
    const row = [projectId, 3, 2, 1, Date.now(), Date.now()];
    run("insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)", row);
    expect(() =>
      run("insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)", row),
    ).toThrow(/UNIQUE/);
  });
});

describe("activities", () => {
  it("keeps project_version unique within a project", () => {
    const values = (id: string) => [id, projectId, 7, "story_create_activity", "m", "h", "[]", "[]", Date.now()];
    const insert =
      "insert into activities (id, project_id, project_version, kind, message, highlight, changes, primary_resources, occurred_at) values (?,?,?,?,?,?,?,?,?)";
    run(insert, values(newId()));
    expect(() => run(insert, values(newId()))).toThrow(/UNIQUE/);
  });

  it("refuses a kind that is not a Tracker activity name", () => {
    expect(() =>
      run(
        "insert into activities (id, project_id, project_version, kind, message, highlight, changes, primary_resources, occurred_at) values (?,?,?,?,?,?,?,?,?)",
        [newId(), projectId, 8, "story_create", "m", "h", "[]", "[]", Date.now()],
      ),
    ).toThrow(/CHECK constraint failed/);
  });
});
