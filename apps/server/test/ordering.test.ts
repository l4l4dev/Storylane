import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";
import { withProject } from "../src/db/tx";
import { POSITION_GAP, placeInList, type MoveRequest } from "../src/services/ordering";
import { stories, type StoryList } from "../src/db/schema";
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

/** placeInList only computes the position; in the service the caller folds it into its own
 *  UPDATE. These unit tests do the same one-statement write. */
const place = (storyId: string, list: StoryList, move: MoveRequest) =>
  withProject(db, owner, projectId, "story:write", (tx) => {
    const position = placeInList(tx, storyId, list, move);
    tx.tx
      .update(stories)
      .set({ position })
      .where(and(eq(stories.id, storyId), eq(stories.projectId, projectId)))
      .run();
    return position;
  });

const order = () =>
  db
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, projectId), eq(stories.list, "icebox")))
    .orderBy(stories.position)
    .all()
    .map((r) => r.id);

describe("placeInList", () => {
  it("appends with a gap when neither neighbour is given", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const positions = db
      .select({ p: stories.position })
      .from(stories)
      .where(eq(stories.projectId, projectId))
      .orderBy(stories.position)
      .all()
      .map((r) => r.p);
    expect(positions).toEqual([POSITION_GAP, POSITION_GAP * 2]);
    expect(order()).toEqual([a, b]);
  });

  it("moves a story between two neighbours without touching them", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const c = seedStory(db, projectId);
    const before = db.select({ id: stories.id, p: stories.position }).from(stories).all();
    place(c, "icebox", { after_id: a, before_id: b });
    expect(order()).toEqual([a, c, b]);
    const after = new Map(db.select({ id: stories.id, p: stories.position }).from(stories).all().map((r) => [r.id, r.p]));
    for (const row of before) if (row.id !== c) expect(after.get(row.id)).toBe(row.p);
  });

  it("places at the head when only before_id is given, and after the named story when only after_id is", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    place(b, "icebox", { before_id: a });
    expect(order()).toEqual([b, a]);
    place(b, "icebox", { after_id: a });
    expect(order()).toEqual([a, b]);
  });

  it("lands directly after a named predecessor that is not the tail", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const c = seedStory(db, projectId);
    const d = seedStory(db, projectId);
    // The seam is bounded by whatever currently follows a, not by the tail of the list.
    place(d, "icebox", { after_id: a });
    expect(order()).toEqual([a, d, b, c]);
  });

  it("refuses a neighbour that is the story itself", () => {
    const a = seedStory(db, projectId);
    expect(() => place(a, "icebox", { after_id: a })).toThrow(/neighbour_is_self/);
    expect(() => place(a, "icebox", { before_id: a })).toThrow(/neighbour_is_self/);
  });

  it("renumbers the list only when the gap between neighbours runs out", () => {
    const a = seedStory(db, projectId, { position: 10 });
    const b = seedStory(db, projectId, { position: 11 });
    const c = seedStory(db, projectId, { position: 12 });
    place(c, "icebox", { after_id: a, before_id: b });
    expect(order()).toEqual([a, c, b]);
    const positions = db
      .select({ p: stories.position })
      .from(stories)
      .where(eq(stories.projectId, projectId))
      .orderBy(stories.position)
      .all()
      .map((r) => r.p);
    // After the renumber (a=GAP, b=2*GAP, c=3*GAP) the move itself still lands c between
    // a and b, so the exact values are [GAP, 1.5*GAP, 2*GAP]; assert the invariants the
    // service promises rather than that arithmetic.
    expect(positions).toEqual([POSITION_GAP, POSITION_GAP * 1.5, POSITION_GAP * 2]);
    expect(new Set(positions).size).toBe(3);
    expect(positions.every((p) => p > 0)).toBe(true);
  });

  it("refuses a neighbour that is in the other list", () => {
    const iceboxStory = seedStory(db, projectId, { list: "icebox" });
    const backlogStory = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    expect(() =>
      place(iceboxStory, "icebox", { after_id: backlogStory }),
    ).toThrow(/neighbour_not_in_list/);
  });

  it("refuses a neighbour from another project", () => {
    const other = seedProject(db, owner);
    const foreign = seedStory(db, other);
    const mine = seedStory(db, projectId);
    expect(() =>
      place(mine, "icebox", { after_id: foreign }),
    ).toThrow(/not_found/);
  });

  it("refuses contradictory neighbours", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const c = seedStory(db, projectId);
    expect(() =>
      place(c, "icebox", { after_id: b, before_id: a }),
    ).toThrow(/neighbours_out_of_order/);
  });
});
