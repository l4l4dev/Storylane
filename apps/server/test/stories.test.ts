import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { listStates } from "../src/services/states";
import {
  createStory,
  deleteStory,
  listStories,
  moveStory,
  readBoard,
  updateStory,
} from "../src/services/stories";
import { withProject, type Actor, type NotPromise, type ProjectTx } from "../src/db/tx";
import { activityLogs, projectMembers, stories } from "../src/db/schema";
import { HttpError } from "../src/http-error";
import type { Db } from "../src/db/client";
import type { StateRow } from "../src/services/states";

let db: Db;
let owner: Actor;
let projectId: string;
let states: StateRow[];

const at = (category: string) => states.find((s) => s.category === category)!;

const write = <T>(fn: (tx: ProjectTx) => T): T =>
  withProject(db, owner, projectId, "story:write", fn as (tx: ProjectTx) => NotPromise<T>);
const read = <T>(fn: (tx: ProjectTx) => T): T =>
  withProject(db, owner, projectId, "story:read", fn as (tx: ProjectTx) => NotPromise<T>);

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof HttpError) return e.code;
    throw e;
  }
};

const activityFor = (action: string) =>
  db
    .select()
    .from(activityLogs)
    .all()
    .filter((r) => r.action === action);

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  states = withProject(db, owner, projectId, "state:read", (tx) => listStates(tx));
});

describe("createStory", () => {
  it("lands in the Icebox with number 1 and position 0", () => {
    const story = write((tx) => createStory(tx, { title: "First" }));
    expect(story).toMatchObject({ number: 1, position: 0, stateId: null, storyType: "feature", points: null });
    expect(story.completedAt).toBeNull();
    if (owner.kind !== "user") throw new Error("unreachable");
    expect(story.requesterId).toBe(owner.userId);
  });

  it("gives consecutive numbers across separate transactions and per project", () => {
    write((tx) => createStory(tx, { title: "a" }));
    write((tx) => createStory(tx, { title: "b" }));
    const third = write((tx) => createStory(tx, { title: "c" }));
    expect(third.number).toBe(3);
    const other = createProject(db, owner, { name: "Other" }).id;
    const elsewhere = withProject(db, owner, other, "story:write", (tx) => createStory(tx, { title: "a" }));
    expect(elsewhere.number).toBe(1);
  });

  it("appends at the end of its column", () => {
    const stateId = at("unstarted").id;
    write((tx) => createStory(tx, { title: "a", stateId, points: 1 }));
    const second = write((tx) => createStory(tx, { title: "b", stateId, points: 1 }));
    expect(second.position).toBe(1);
    // The Icebox is its own column: a story landing there starts at 0 again.
    const iced = write((tx) => createStory(tx, { title: "c" }));
    expect(iced.position).toBe(0);
  });

  it("refuses a point value that is not on the project's scale", () => {
    expect(status(() => write((tx) => createStory(tx, { title: "a", points: 4 })))).toBe(400);
    expect(code(() => write((tx) => createStory(tx, { title: "a", points: 4 })))).toBe("points_off_scale");
  });

  it("applies the estimation gate", () => {
    expect(status(() => write((tx) => createStory(tx, { title: "a", stateId: at("in_progress").id })))).toBe(409);
    expect(code(() => write((tx) => createStory(tx, { title: "a", stateId: at("in_progress").id })))).toBe(
      "estimate_required",
    );
    expect(status(() => write((tx) => createStory(tx, { title: "a", stateId: at("unstarted").id })))).toBe(200);
  });

  it("refuses a state from another project with 404", () => {
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = withProject(db, owner, other, "state:read", (tx) => listStates(tx))[0]!;
    expect(status(() => write((tx) => createStory(tx, { title: "a", stateId: foreign.id })))).toBe(404);
  });

  it("refuses an assignee who is not a member of the project", () => {
    const outsider = seedUser(db, "outsider@example.test");
    if (outsider.kind !== "user") throw new Error("unreachable");
    expect(code(() => write((tx) => createStory(tx, { title: "a", assigneeId: outsider.userId })))).toBe(
      "assignee_not_member",
    );
    db.insert(projectMembers)
      .values({ projectId, userId: outsider.userId, role: "member", joinedAt: Date.now() })
      .run();
    const assigned = write((tx) => createStory(tx, { title: "a", assigneeId: outsider.userId }));
    expect(assigned.assigneeId).toBe(outsider.userId);
  });

  it("writes exactly one story.created row and rolls both back together", () => {
    write((tx) => createStory(tx, { title: "a" }));
    expect(activityFor("story.created")).toHaveLength(1);
    expect(() =>
      write((tx) => {
        createStory(tx, { title: "doomed" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(activityFor("story.created")).toHaveLength(1);
    expect(db.select().from(stories).all()).toHaveLength(1);
  });
});

describe("updateStory", () => {
  it("changes fields, bumps updated_at and logs one story.updated row", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    const updated = write((tx) => updateStory(tx, story.id, { title: "b", points: 3, storyType: "bug" }));
    expect(updated).toMatchObject({ title: "b", points: 3, storyType: "bug" });
    expect(activityFor("story.updated")).toHaveLength(1);
    const payload = JSON.parse(activityFor("story.updated")[0]!.payload!) as Record<string, unknown>;
    expect(payload.points).toEqual({ from: null, to: 3 });
  });

  it("cannot change the story's number (no such field) and the trigger backs it up", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    expect(() => db.$client.run("update stories set number = 99 where id = ?", [story.id])).toThrow(
      /stories.number is pinned/,
    );
  });

  it("refuses to remove the estimate from a feature that sits past unstarted", () => {
    const story = write((tx) => createStory(tx, { title: "a", stateId: at("unstarted").id, points: 3 }));
    write((tx) => moveStory(tx, story.id, { stateId: at("in_progress").id, orderedIds: [story.id] }));
    expect(status(() => write((tx) => updateStory(tx, story.id, { points: null })))).toBe(409);
  });

  it("404s for a story in another project", () => {
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = withProject(db, owner, other, "story:write", (tx) => createStory(tx, { title: "x" }));
    expect(status(() => write((tx) => updateStory(tx, foreign.id, { title: "y" })))).toBe(404);
  });
});

describe("moveStory", () => {
  it("sets completed_at when entering a done state and clears it when leaving", () => {
    const story = write((tx) => createStory(tx, { title: "a", stateId: at("unstarted").id, points: 2 }));
    const done = write((tx) => moveStory(tx, story.id, { stateId: at("done").id, orderedIds: [story.id] }));
    expect(done.completedAt).toBeGreaterThan(0);
    const stillDone = write((tx) => moveStory(tx, story.id, { stateId: at("done").id, orderedIds: [story.id] }));
    expect(stillDone.completedAt).toBe(done.completedAt);
    const back = write((tx) => moveStory(tx, story.id, { stateId: at("in_progress").id, orderedIds: [story.id] }));
    expect(back.completedAt).toBeNull();
  });

  it("moving to the Icebox clears state and completed_at", () => {
    const story = write((tx) => createStory(tx, { title: "a", stateId: at("done").id, points: 2 }));
    const iced = write((tx) => moveStory(tx, story.id, { stateId: null, orderedIds: [story.id] }));
    expect(iced.stateId).toBeNull();
    expect(iced.completedAt).toBeNull();
  });

  it("reorders within a column to a full reverse, positions 0..n-1", () => {
    const stateId = at("unstarted").id;
    const ids = [0, 1, 2, 3].map((i) => write((tx) => createStory(tx, { title: `s${i}`, stateId, points: 1 })).id);
    const reversed = [...ids].reverse();
    write((tx) => moveStory(tx, reversed[0]!, { stateId, orderedIds: reversed }));
    const board = read((tx) => readBoard(tx));
    const column = board.columns.find((col) => col.stateId === stateId)!;
    expect(column.stories.map((s) => s.id)).toEqual(reversed);
    expect(column.stories.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  it("leaves the source column densely numbered", () => {
    const stateId = at("unstarted").id;
    const ids = [0, 1, 2].map((i) => write((tx) => createStory(tx, { title: `s${i}`, stateId, points: 1 })).id);
    const target = at("in_progress").id;
    write((tx) => moveStory(tx, ids[0]!, { stateId: target, orderedIds: [ids[0]!] }));
    const board = read((tx) => readBoard(tx));
    const source = board.columns.find((col) => col.stateId === stateId)!;
    expect(source.stories.map((s) => s.position)).toEqual([0, 1]);
    expect(source.stories.map((s) => s.id)).toEqual([ids[1]!, ids[2]!]);
  });

  it("logs story.state_changed on a state change and story.moved on a pure reorder", () => {
    const stateId = at("unstarted").id;
    const a = write((tx) => createStory(tx, { title: "a", stateId, points: 1 })).id;
    const b = write((tx) => createStory(tx, { title: "b", stateId, points: 1 })).id;
    write((tx) => moveStory(tx, a, { stateId, orderedIds: [b, a] }));
    expect(activityFor("story.moved")).toHaveLength(1);
    expect(activityFor("story.state_changed")).toHaveLength(0);
    write((tx) => moveStory(tx, a, { stateId: at("in_progress").id, orderedIds: [a] }));
    expect(activityFor("story.state_changed")).toHaveLength(1);
  });

  it("rejects an orderedIds list that is not the target column after the move", () => {
    const stateId = at("unstarted").id;
    const a = write((tx) => createStory(tx, { title: "a", stateId, points: 1 })).id;
    write((tx) => createStory(tx, { title: "b", stateId, points: 1 }));
    expect(status(() => write((tx) => moveStory(tx, a, { stateId, orderedIds: [a] })))).toBe(400);
    expect(code(() => write((tx) => moveStory(tx, a, { stateId, orderedIds: [a] })))).toBe("ordered_ids_invalid");
  });

  it("applies the estimation gate on the move path too", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    expect(
      status(() => write((tx) => moveStory(tx, story.id, { stateId: at("in_progress").id, orderedIds: [story.id] }))),
    ).toBe(409);
  });

  it("404s for a state that belongs to another project", () => {
    const story = write((tx) => createStory(tx, { title: "a", points: 1 }));
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = withProject(db, owner, other, "state:read", (tx) => listStates(tx))[0]!;
    expect(
      status(() => write((tx) => moveStory(tx, story.id, { stateId: foreign.id, orderedIds: [story.id] }))),
    ).toBe(404);
  });
});

describe("deleteStory", () => {
  it("keeps the activity trail with story_id nulled and logs story.deleted", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    withProject(db, owner, projectId, "story:delete", (tx) => deleteStory(tx, story.id));
    expect(db.select().from(stories).all()).toHaveLength(0);
    const rows = db.select().from(activityLogs).all();
    expect(rows.every((r) => r.storyId === null)).toBe(true);
    expect(activityFor("story.deleted")).toHaveLength(1);
    expect(JSON.parse(activityFor("story.deleted")[0]!.payload!)).toMatchObject({ number: 1, title: "a" });
  });

  it("closes the gap left in the column it was deleted from", () => {
    const stateId = at("unstarted").id;
    const ids = [0, 1, 2].map((i) => write((tx) => createStory(tx, { title: `s${i}`, stateId, points: 1 })).id);
    withProject(db, owner, projectId, "story:delete", (tx) => deleteStory(tx, ids[0]!));
    const board = read((tx) => readBoard(tx));
    const column = board.columns.find((col) => col.stateId === stateId)!;
    expect(column.stories.map((s) => s.position)).toEqual([0, 1]);
  });

  it("404s for a story in another project", () => {
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = withProject(db, owner, other, "story:write", (tx) => createStory(tx, { title: "x" }));
    expect(
      status(() => withProject(db, owner, projectId, "story:delete", (tx) => deleteStory(tx, foreign.id))),
    ).toBe(404);
  });
});

describe("readBoard", () => {
  it("returns the states in position order and one column per state plus the Icebox", () => {
    write((tx) => createStory(tx, { title: "iced" }));
    write((tx) => createStory(tx, { title: "todo", stateId: at("unstarted").id, points: 1 }));
    const board = read((tx) => readBoard(tx));
    expect(board.states.map((s) => s.position)).toEqual(board.states.map((_, i) => i));
    expect(board.columns[0]!.stateId).toBeNull();
    expect(board.columns[0]!.stories.map((s) => s.title)).toEqual(["iced"]);
    expect(board.columns.length).toBe(board.states.length + 1);
    // Every story in the project appears exactly once.
    const seen = board.columns.flatMap((col) => col.stories.map((s) => s.id));
    expect(new Set(seen).size).toBe(2);
  });

  it("never shows another project's stories", () => {
    write((tx) => createStory(tx, { title: "mine" }));
    const other = createProject(db, owner, { name: "Other" }).id;
    withProject(db, owner, other, "story:write", (tx) => createStory(tx, { title: "theirs" }));
    expect(read((tx) => listStories(tx)).map((s) => s.title)).toEqual(["mine"]);
    const board = read((tx) => readBoard(tx));
    expect(board.columns.flatMap((col) => col.stories.map((s) => s.title))).toEqual(["mine"]);
  });
});
