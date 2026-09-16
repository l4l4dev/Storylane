import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedUser } from "./harness";
import { createProject, listProjects, setArchived, updateProject } from "../src/services/projects";
import { withProject, type Actor } from "../src/db/tx";
import { HttpError } from "../src/http-error";
import { BUILT_IN_POINT_SCALES, DEFAULT_POINT_SCALE } from "../src/db/schema";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
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

describe("listProjects ordering", () => {
  it("puts active projects before archived, ordered by name case-insensitively, not by creation order", () => {
    // Created oldest to newest as Apple, Mango, Zebra: creation order and name order
    // disagree in reverse, so a createdAt-only tiebreak would misorder this.
    createProject(db, owner, { name: "Apple" });
    const mango = createProject(db, owner, { name: "mango" }); // archived — must still fall last
    createProject(db, owner, { name: "Zebra" });
    withProject(db, owner, mango.id, "project:archive", (tx) => setArchived(tx, true));
    const names = listProjects(db, owner).map((p) => p.name);
    expect(names).toEqual(["Apple", "Zebra", "mango"]);
  });
});

describe("updateProject point scale validation", () => {
  // PROVISIONAL (Task 7 owns the settings service): point_scale is now the stored
  // comma-separated ascending list, so "custom" is any list that is not a built-in.
  it("accepts a custom ascending scale", () => {
    const project = createProject(db, owner, { name: "P" });
    const updated = withProject(db, owner, project.id, "project:update", (tx) =>
      updateProject(tx, { pointScale: "0,1,2,3,5,8,13" }),
    );
    expect(updated.pointScale).toBe("0,1,2,3,5,8,13");
  });

  it("accepts each built-in scale", () => {
    const project = createProject(db, owner, { name: "P" });
    for (const scale of BUILT_IN_POINT_SCALES) {
      const updated = withProject(db, owner, project.id, "project:update", (tx) =>
        updateProject(tx, { pointScale: scale }),
      );
      expect(updated.pointScale).toBe(scale);
    }
  });

  it("defaults a new project to the linear scale", () => {
    expect(createProject(db, owner, { name: "P" }).pointScale).toBe(DEFAULT_POINT_SCALE);
  });

  it("rejects an empty scale with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() => withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { pointScale: "" }))),
    ).toBe(400);
  });

  it("rejects an unsorted scale with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { pointScale: "0,3,1" })),
      ),
    ).toBe(400);
  });

  it("rejects a negative value with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { pointScale: "-1,2" })),
      ),
    ).toBe(400);
  });

  it("rejects a non-numeric value with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { pointScale: "0,1,two" })),
      ),
    ).toBe(400);
  });
});
