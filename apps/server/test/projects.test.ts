import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedUser } from "./harness";
import { createProject, listProjects, setArchived, updateProject } from "../src/services/projects";
import { withProject, type Actor } from "../src/db/tx";
import { HttpError } from "../src/http-error";
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
  it("accepts a valid custom scale", () => {
    const project = createProject(db, owner, { name: "P" });
    const updated = withProject(db, owner, project.id, "project:update", (tx) =>
      updateProject(tx, { pointScale: "custom", customPoints: [1, 2, 3] }),
    );
    expect(updated.pointScale).toBe("custom");
    expect(updated.customPoints).toEqual([1, 2, 3]);
  });

  it("rejects an empty custom list with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) =>
          updateProject(tx, { pointScale: "custom", customPoints: [] }),
        ),
      ),
    ).toBe(400);
  });

  it("rejects an unsorted custom list with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) =>
          updateProject(tx, { pointScale: "custom", customPoints: [3, 1, 2] }),
        ),
      ),
    ).toBe(400);
  });

  it("rejects a negative value in the custom list with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) =>
          updateProject(tx, { pointScale: "custom", customPoints: [-1, 2] }),
        ),
      ),
    ).toBe(400);
  });

  it("rejects a non-integer value in the custom list with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) =>
          updateProject(tx, { pointScale: "custom", customPoints: [1, 2.5] }),
        ),
      ),
    ).toBe(400);
  });

  it("rejects non-null customPoints under a non-custom scale with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) =>
          updateProject(tx, { pointScale: "fibonacci", customPoints: [1, 2] }),
        ),
      ),
    ).toBe(400);
  });
});
