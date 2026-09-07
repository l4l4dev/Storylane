import { beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { disableUser, makeTestDb, seedProject, seedUser } from "./harness";
import { loadInProject, reorder, withProject, withTwoProjects, type Actor, type ProjectTx } from "../src/db/tx";
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
    // A real (seeded, enabled) user — an unseeded id would hit the disabled-user 401 branch
    // first, which is a different case (see "returns 401 for a disabled user" below).
    const admin = seedUser(db, "admin@example.test", true);
    expect(status(() => withProject(db, admin, "nope", "project:read", () => 1))).toBe(404);
  });
  it("returns 401 for a disabled user, whatever their membership", () => {
    disableUser(db, owner);
    expect(status(() => withProject(db, owner, pA, "project:read", () => 1))).toBe(401);
    expect(status(() => withProject(db, owner, pA, "story:write", () => 1))).toBe(401);
  });
  it("returns 401 for a disabled user even when the project doesn't exist", () => {
    // The disabled check must not depend on the project lookup, or a disabled user probing
    // a project id would learn whether it exists (404) before learning they're disabled (401).
    disableUser(db, owner);
    expect(status(() => withProject(db, owner, "no-such-project", "project:read", () => 1))).toBe(401);
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

describe("ProjectTx invalidation", () => {
  it("throws if a callback captures tx and uses it after withProject returns", () => {
    let captured: import("../src/db/tx").ProjectTx | undefined;
    withProject(db, owner, pA, "story:write", (tx) => {
      captured = tx;
      return 1;
    });
    expect(() => captured!.tx).toThrow("ProjectTx used outside its transaction");
    expect(() => loadInProject(captured!, scopedItems, "a1")).toThrow("ProjectTx used outside its transaction");
  });

  it("rejects a thenable returned from the callback, and its deferred insert throws even if invoked", () => {
    // A structurally-thenable object passes the NotPromise type (a loosely-typed `then` is
    // not recognized as PromiseLike), so this must be caught at runtime instead. `then` closes
    // over the live `tx` param, mirroring the reported bypass: an INSERT meant to run after
    // this function returns (i.e. after commit) if some caller awaited the result.
    let sneaky: { then(cb: (v: number) => void): void } | undefined;
    expect(() =>
      withProject(db, owner, pA, "story:write", (tx) => {
        sneaky = {
          then(cb) {
            tx.tx.insert(scopedItems).values({ id: "sneaky", projectId: pA, position: 0, label: "" }).run();
            cb(1);
          },
        };
        return sneaky as unknown as number;
      }),
    ).toThrow("withProject callback must be synchronous");
    // Defense in depth: even if the runtime thenable check above were absent or buggy, the
    // captured tx is invalid by the time anything could call sneaky.then(), so the insert
    // inside it throws rather than silently writing after commit.
    expect(() => sneaky!.then(() => {})).toThrow("ProjectTx used outside its transaction");
    expect(db.select().from(scopedItems).where(eq(scopedItems.id, "sneaky")).all()).toHaveLength(0);
  });

  it("rejects an async callback smuggled in through an explicit `any` type argument", () => {
    // NotPromise<any> is `any`, so an explicit <any> defeats the compile-time guard entirely;
    // rejectThenable is what actually stops it. The insert runs synchronously (an async function
    // body runs up to its first await before returning a pending Promise), but the throw below
    // rolls the whole transaction back, so it never lands.
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately bypassing NotPromise<T>
      withProject<any>(db, owner, pA, "story:write", async (tx) => {
        tx.tx.insert(scopedItems).values({ id: "async-any", projectId: pA, position: 0, label: "" }).run();
        // eslint-disable-next-line local/no-await-in-transaction -- the point of this test is that the runtime catches what the lint rule would also catch
        await Promise.resolve();
        return 1;
      }),
    ).toThrow("withProject callback must be synchronous");
    expect(db.select().from(scopedItems).where(eq(scopedItems.id, "async-any")).all()).toHaveLength(0);
  });

  it("rejects an async callback smuggled in through a widened function-type variable", () => {
    // tsc cannot see that `f` is async once it's held as `(tx: ProjectTx) => unknown`.
    const f: (tx: ProjectTx) => unknown = async (tx) => {
      tx.tx.insert(scopedItems).values({ id: "async-widened", projectId: pA, position: 0, label: "" }).run();
      await Promise.resolve();
      return 1;
    };
    expect(() => withProject(db, owner, pA, "story:write", f)).toThrow(
      "withProject callback must be synchronous",
    );
    expect(db.select().from(scopedItems).where(eq(scopedItems.id, "async-widened")).all()).toHaveLength(0);
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
  it("404s on an id the scope never had", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "x1", projectId: pA, position: 0, label: "" }).run();
      expect(status(() => reorder(tx, scopedItems, eq(scopedItems.projectId, pA), ["x1", "ghost"]))).toBe(404);
    });
  });

  it("400s on a list that is the wrong size or has a duplicate", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "x1", projectId: pA, position: 0, label: "" }).run();
      tx.tx.insert(scopedItems).values({ id: "x2", projectId: pA, position: 1, label: "" }).run();
      expect(status(() => reorder(tx, scopedItems, eq(scopedItems.projectId, pA), ["x1"]))).toBe(400);
      expect(status(() => reorder(tx, scopedItems, eq(scopedItems.projectId, pA), ["x1", "x1"]))).toBe(400);
    });
  });
});
