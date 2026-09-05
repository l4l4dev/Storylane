import { beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { disableUser, makeTestDb, seedProject, seedUser } from "./harness";
import { loadInProject, reorder, withProject, withTwoProjects, type Actor } from "../src/db/tx";
import { scopedItems } from "./scoped-items";
import { HttpError } from "../src/http-error";
import { ALL_ACTIONS, expected } from "../src/authz/permissions";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor, member: Actor, viewer: Actor, outsider: Actor;
const anon: Actor = { kind: "anonymous" };
let pA: string, pB: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
  viewer = seedUser(db, "viewer@example.test");
  outsider = seedUser(db, "outsider@example.test");
  pA = seedProject(db, owner, [
    [member, "member"],
    [viewer, "viewer"],
  ]);
  pB = seedProject(db, owner, [[member, "member"]]);
});

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

describe("withProject", () => {
  it("maps roles to the fixture for a read action", () => {
    expect(status(() => withProject(db, owner, pA, "project:read", () => 1))).toBe(200);
    expect(status(() => withProject(db, viewer, pA, "project:read", () => 1))).toBe(200);
    expect(status(() => withProject(db, outsider, pA, "project:read", () => 1))).toBe(404);
    expect(status(() => withProject(db, anon, pA, "project:read", () => 1))).toBe(401);
  });
  it("maps roles to the fixture for a write action", () => {
    expect(status(() => withProject(db, member, pA, "story:write", () => 1))).toBe(200);
    expect(status(() => withProject(db, viewer, pA, "story:write", () => 1))).toBe(403);
    expect(status(() => withProject(db, member, pA, "story:delete", () => 1))).toBe(403);
    expect(status(() => withProject(db, owner, pA, "story:delete", () => 1))).toBe(200);
  });
  it("returns 404 for an unknown project even to an admin", () => {
    const admin: Actor = { kind: "user", userId: "u-admin", isAdmin: true };
    expect(status(() => withProject(db, admin, "nope", "project:read", () => 1))).toBe(404);
  });
  it("returns 401 for a disabled user, whatever their membership", () => {
    disableUser(db, owner);
    expect(status(() => withProject(db, owner, pA, "project:read", () => 1))).toBe(401);
    expect(status(() => withProject(db, owner, pA, "story:write", () => 1))).toBe(401);
  });
  it("rejects writes to an archived project with 409, before the role check", () => {
    db.run(sql`update projects set archived_at = 1 where id = ${pA}`);
    expect(status(() => withProject(db, owner, pA, "story:write", () => 1))).toBe(409);
    // 409 wins over the viewer's 403: the project is closed for everyone.
    expect(status(() => withProject(db, viewer, pA, "story:write", () => 1))).toBe(409);
    // ... but 404 still wins over 409, so archiving does not leak the project's existence.
    expect(status(() => withProject(db, outsider, pA, "story:write", () => 1))).toBe(404);
    expect(status(() => withProject(db, anon, pA, "story:write", () => 1))).toBe(401);
    // Reads are unaffected.
    expect(status(() => withProject(db, owner, pA, "story:read", () => 1))).toBe(200);
    expect(status(() => withProject(db, viewer, pA, "project:read", () => 1))).toBe(200);
    // Un-archiving and deleting stay possible, and stay owner-only.
    expect(status(() => withProject(db, owner, pA, "project:archive", () => 1))).toBe(200);
    expect(status(() => withProject(db, owner, pA, "project:delete", () => 1))).toBe(200);
    expect(status(() => withProject(db, member, pA, "project:archive", () => 1))).toBe(403);
    expect(status(() => withProject(db, member, pA, "project:delete", () => 1))).toBe(403);
  });
  it("rolls back when fn throws", () => {
    expect(() =>
      withProject(db, owner, pA, "story:write", (tx) => {
        tx.tx.insert(scopedItems).values({ id: "i1", projectId: pA, position: 0, label: "x" }).run();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.select().from(scopedItems).all()).toHaveLength(0);
  });
});

describe("permission fixture invariants", () => {
  it("never grants a non-member or an anonymous caller anything", () => {
    for (const action of ALL_ACTIONS) {
      expect([action, expected(action, "non-member")]).toEqual([action, 404]);
      expect([action, expected(action, "anonymous")]).toEqual([action, 401]);
    }
  });
});

describe("withTwoProjects", () => {
  it("requires the action in both projects", () => {
    expect(status(() => withTwoProjects(db, member, pA, pB, "story:move-cross-project", () => 1))).toBe(200);
    // The source project is authorized first, so the viewer's 403 in pA surfaces before pB is looked at.
    expect(status(() => withTwoProjects(db, viewer, pA, pB, "story:move-cross-project", () => 1))).toBe(403);
    // A member allowed in pA but absent from a project they cannot see still gets 404, never 403.
    const pC = seedProject(db, viewer);
    expect(status(() => withTwoProjects(db, member, pA, pC, "story:move-cross-project", () => 1))).toBe(404);
  });
});

describe("loadInProject", () => {
  it("returns the row inside the project and 404 for a row in another project", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "a1", projectId: pA, position: 0, label: "A" }).run();
    });
    withProject(db, owner, pB, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "b1", projectId: pB, position: 0, label: "B" }).run();
    });
    withProject(db, owner, pA, "story:read", (tx) => {
      expect(loadInProject(tx, scopedItems, "a1").label).toBe("A");
      expect(status(() => loadInProject(tx, scopedItems, "b1"))).toBe(404);
      expect(status(() => loadInProject(tx, scopedItems, "zzz"))).toBe(404);
    });
  });
});

describe("reorder", () => {
  it("assigns 0..n-1 in the given order without UNIQUE violations, including a full reverse", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      for (let i = 0; i < 5; i++)
        tx.tx.insert(scopedItems).values({ id: `r${i}`, projectId: pA, position: i, label: "" }).run();
      reorder(tx, scopedItems, eq(scopedItems.projectId, pA), ["r4", "r3", "r2", "r1", "r0"]);
      const rows = tx.tx
        .select()
        .from(scopedItems)
        .where(eq(scopedItems.projectId, pA))
        .orderBy(scopedItems.position)
        .all();
      expect(rows.map((r) => r.id)).toEqual(["r4", "r3", "r2", "r1", "r0"]);
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
    });
  });
  it("rejects an id list that is not a permutation of the scope", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "x1", projectId: pA, position: 0, label: "" }).run();
      expect(() => reorder(tx, scopedItems, eq(scopedItems.projectId, pA), ["x1", "ghost"])).toThrow(/permutation/);
    });
  });
});
