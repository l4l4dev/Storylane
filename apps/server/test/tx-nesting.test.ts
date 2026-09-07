import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedUser } from "./harness";
import { withProject, withTwoProjects, type Actor } from "../src/db/tx";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let pA: string;
let pB: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  pA = seedProject(db, owner);
  pB = seedProject(db, owner);
});

describe("withProject nesting", () => {
  it("throws a clear error when nested", () => {
    expect(() =>
      withProject(db, owner, pA, "project:read", () => withProject(db, owner, pB, "project:read", () => 1)),
    ).toThrow("withProject cannot be nested");
  });

  it("throws when withTwoProjects is nested inside withProject", () => {
    expect(() =>
      withProject(db, owner, pA, "project:read", () =>
        withTwoProjects(db, owner, pA, pB, "story:move-cross-project", () => 1),
      ),
    ).toThrow("withProject cannot be nested");
  });

  it("releases the guard after a callback throws, so the next call still works", () => {
    expect(() =>
      withProject(db, owner, pA, "story:write", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(withProject(db, owner, pA, "project:read", (tx) => tx.projectId)).toBe(pA);
  });

  it("releases the guard after an authorization failure", () => {
    const outsider = seedUser(db, "outsider@example.test");
    expect(() => withProject(db, outsider, pA, "project:read", () => 1)).toThrow();
    expect(withProject(db, owner, pA, "project:read", (tx) => tx.projectId)).toBe(pA);
  });
});
