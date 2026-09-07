import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedUser } from "./harness";
import { changePassword, revokeUserSessions } from "../src/auth/sessions";
import { createProject } from "../src/services/projects";
import { withProject, withTwoProjects, type Actor } from "../src/db/tx";
import { projects } from "../src/db/schema";
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

describe("revokeUserSessions nesting", () => {
  it("refuses to run inside withProject", () => {
    if (owner.kind !== "user") throw new Error("unreachable");
    const userId = owner.userId;
    expect(() =>
      withProject(db, owner, pA, "project:read", () => revokeUserSessions(db, userId)),
    ).toThrow("revokeUserSessions cannot run inside withProject");
  });

  it("refuses changePassword inside withProject too", () => {
    if (owner.kind !== "user") throw new Error("unreachable");
    const userId = owner.userId;
    expect(() =>
      withProject(db, owner, pA, "project:read", () => changePassword(db, userId, "h", Date.now())),
    ).toThrow("changePassword cannot run inside withProject");
  });

  it("runs on its own outside withProject", () => {
    if (owner.kind !== "user") throw new Error("unreachable");
    expect(revokeUserSessions(db, owner.userId)).toBe(0);
  });
});

describe("createProject nesting", () => {
  it("refuses to run inside withProject and creates nothing", () => {
    const before = db.select().from(projects).all().length;
    expect(() =>
      withProject(db, owner, pA, "project:read", () => createProject(db, owner, { name: "Nested" })),
    ).toThrow("createProject cannot run inside withProject");
    expect(db.select().from(projects).all().length).toBe(before);
  });
});
