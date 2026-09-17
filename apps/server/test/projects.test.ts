import { beforeEach, describe, expect, it } from "bun:test";
import { BUILT_IN_POINT_SCALES } from "@storylane/core";
import { makeTestDb, seedStory, seedUser } from "./harness";
import { createProject, listProjects, readProject, setArchived, updateProject } from "../src/services/projects";
import { withProject, type Actor } from "../src/db/tx";
import { HttpError } from "../src/http-error";
import { DEFAULT_POINT_SCALE } from "../src/db/schema";
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
  it("accepts a custom ascending scale", () => {
    const project = createProject(db, owner, { name: "P" });
    const updated = withProject(db, owner, project.id, "project:update", (tx) =>
      updateProject(tx, { point_scale: "0,1,2,3,5,8,13" }),
    );
    expect(updated.point_scale).toBe("0,1,2,3,5,8,13");
    expect(updated.point_scale_is_custom).toBe(true);
  });

  it("accepts each built-in scale", () => {
    const project = createProject(db, owner, { name: "P" });
    for (const scale of BUILT_IN_POINT_SCALES) {
      const updated = withProject(db, owner, project.id, "project:update", (tx) =>
        updateProject(tx, { point_scale: scale }),
      );
      expect(updated.point_scale).toBe(scale);
      expect(updated.point_scale_is_custom).toBe(false);
    }
  });

  it("defaults a new project to the linear scale", () => {
    expect(createProject(db, owner, { name: "P" }).point_scale).toBe(DEFAULT_POINT_SCALE);
  });

  it("rejects an empty scale with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() => withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { point_scale: "" }))),
    ).toBe(400);
  });

  it("rejects an unsorted scale with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { point_scale: "0,3,1" })),
      ),
    ).toBe(400);
  });

  it("rejects a negative value with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { point_scale: "-1,2" })),
      ),
    ).toBe(400);
  });

  it("rejects a non-numeric value with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,two" })),
      ),
    ).toBe(400);
  });

  it("rejects a value with a space with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { point_scale: "1, 2" })),
      ),
    ).toBe(400);
  });

  it("rejects exponential notation with 400", () => {
    const project = createProject(db, owner, { name: "P" });
    expect(
      status(() =>
        withProject(db, owner, project.id, "project:update", (tx) => updateProject(tx, { point_scale: "1e3,2" })),
      ),
    ).toBe(400);
  });
});

describe("project settings", () => {
  let projectId: string;

  beforeEach(() => {
    projectId = createProject(db, owner, { name: "P" }).id;
  });

  it("returns Tracker's settings shape with point_scale_is_custom derived", () => {
    const settings = withProject(db, owner, projectId, "project:read", (tx) => readProject(tx));
    expect(settings.point_scale).toBe("0,1,2,3");
    expect(settings.point_scale_is_custom).toBe(false);
    expect(settings.iteration_length).toBe(1);
    expect(settings.velocity_averaged_over).toBe(3);
    expect(settings.initial_velocity).toBe(10);
    expect(settings.automatic_planning).toBe(true);
  });

  it("rewrites estimates to the nearest value when a built-in scale changes", () => {
    withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,2,3,5,8" }));
    const storyId = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 5 });
    withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,2,4,8" }));
    const row = db.$client.query("select estimate from stories where id = ?").get(storyId) as { estimate: number };
    expect(row.estimate).toBe(4);
  });

  it("refuses a start date that disagrees with the week start day", () => {
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { start_date: "2026-09-15" })),
    ).toThrow(/start_date/);
  });

  it("refuses an unknown IANA time zone", () => {
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { time_zone: "Mars/Olympus" })),
    ).toThrow(/time_zone_invalid/);
  });

  it("refuses to turn bug and chore estimation back off", () => {
    withProject(db, owner, projectId, "project:update", (tx) =>
      updateProject(tx, { bugs_and_chores_are_estimatable: true }),
    );
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) =>
        updateProject(tx, { bugs_and_chores_are_estimatable: false }),
      ),
    ).toThrow(/bugs_and_chores_estimation_is_one_way/);
  });

  it("hands planned stories back to the backlog when automatic planning returns", () => {
    withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { automatic_planning: false }));
    const storyId = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    db.$client.run("update stories set current_state = 'planned' where id = ?", [storyId]);
    withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { automatic_planning: true }));
    const row = db.$client.query("select current_state as s from stories where id = ?").get(storyId) as { s: string };
    expect(row.s).toBe("unstarted");
  });

  it("refuses to leave a custom scale for a built-in one", () => {
    withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,3,7" }));
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,2,3" })),
    ).toThrow(/point_scale_custom_is_one_way/);
  });

  it("clears iteration overrides when the calendar moves", () => {
    db.$client.run(
      "insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)",
      [projectId, 2, 2, 1, Date.now(), Date.now()],
    );
    withProject(db, owner, projectId, "project:update", (tx) =>
      updateProject(tx, { start_date: "2026-09-21" }),
    );
    const left = db.$client.query("select count(*) as n from iteration_overrides").get() as { n: number };
    expect(left.n).toBe(0);
  });
});
