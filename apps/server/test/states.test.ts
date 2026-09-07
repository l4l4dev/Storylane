import { beforeEach, describe, expect, it } from "bun:test";
import templates from "../../../spec/fixtures/state-templates.json";
import { makeTestDb, seedStory, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { createState, deleteState, listStates, reorderStates, updateState } from "../src/services/states";
import { withProject, type Actor } from "../src/db/tx";
import { activityLogs } from "../src/db/schema";
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

describe("createProject", () => {
  it("makes the creator the owner and seeds the classic template byte for byte", () => {
    const project = createProject(db, owner, { name: "Storylane" });
    expect(project.role).toBe("owner");
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    // Compared with the wider (string-typed) JSON fixture as the receiver, not the narrower
    // StateCategory-typed service result, so the union-vs-string mismatch doesn't fail tsc.
    expect(templates.classic.states).toEqual(
      states.map((s) => ({ name: s.name, category: s.category, position: s.position, actionLabel: s.actionLabel })),
    );
  });

  it("can seed the minimal template instead", () => {
    const project = createProject(db, owner, { name: "Small", template: "minimal" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(templates.minimal.states).toEqual(
      states.map((s) => ({ name: s.name, category: s.category, position: s.position, actionLabel: s.actionLabel })),
    );
  });

  it("logs project.created and one state.created per state in the same transaction", () => {
    const project = createProject(db, owner, { name: "Storylane" });
    const rows = db.select().from(activityLogs).all().filter((r) => r.projectId === project.id);
    expect(rows.filter((r) => r.action === "project.created")).toHaveLength(1);
    expect(rows.filter((r) => r.action === "state.created")).toHaveLength(templates.classic.states.length);
    expect(rows.every((r) => r.actorId === (owner as { userId: string }).userId)).toBe(true);
  });
});

describe("state writes", () => {
  it("appends a new state after the last position", () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const created = withProject(db, owner, project.id, "state:write", (tx) =>
      createState(tx, { name: "Blocked", category: "in_progress", actionLabel: "Unblock" }),
    );
    expect(created.position).toBe(templates.minimal.states.length);
  });

  it("renames and relabels but refuses a category change with 409", () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const [first] = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const renamed = withProject(db, owner, project.id, "state:write", (tx) =>
      updateState(tx, first!.id, { name: "Ready", actionLabel: "Begin" }),
    );
    expect(renamed).toMatchObject({ name: "Ready", actionLabel: "Begin", category: "unstarted" });
    expect(
      status(() => withProject(db, owner, project.id, "state:write", (tx) => updateState(tx, first!.id, { category: "done" }))),
    ).toBe(409);
  });

  it("reorders to a full reverse and leaves positions 0..n-1", () => {
    const project = createProject(db, owner, { name: "P" });
    const before = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const reversed = [...before].reverse().map((s) => s.id);
    const after = withProject(db, owner, project.id, "state:write", (tx) => reorderStates(tx, reversed));
    expect(after.map((s) => s.id)).toEqual(reversed);
    expect(after.map((s) => s.position)).toEqual(before.map((_, i) => i));
  });

  it("400s a reorder with the wrong count", () => {
    const project = createProject(db, owner, { name: "P" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(
      status(() => withProject(db, owner, project.id, "state:write", (tx) => reorderStates(tx, [states[0]!.id]))),
    ).toBe(400);
  });

  it("404s a reorder naming a state from another project", () => {
    const project = createProject(db, owner, { name: "P" });
    const other = createProject(db, owner, { name: "Other" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const foreign = withProject(db, owner, other.id, "state:read", (tx) => listStates(tx))[0]!.id;
    expect(
      status(() =>
        withProject(db, owner, project.id, "state:write", (tx) =>
          reorderStates(tx, [...states.slice(1).map((s) => s.id), foreign]),
        ),
      ),
    ).toBe(404);
  });
});

describe("deleteState", () => {
  it("refuses to remove the last unstarted or the last done state", () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const todo = states.find((s) => s.category === "unstarted")!;
    const done = states.find((s) => s.category === "done")!;
    for (const id of [todo.id, done.id]) {
      expect(status(() => withProject(db, owner, project.id, "state:delete", (tx) => deleteState(tx, id)))).toBe(409);
    }
  });

  it("refuses to remove a state that still holds stories", () => {
    const project = createProject(db, owner, { name: "P" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const spare = states.find((s) => s.category === "in_progress")!;
    seedStory(db, project.id, { stateId: spare.id });
    expect(status(() => withProject(db, owner, project.id, "state:delete", (tx) => deleteState(tx, spare.id)))).toBe(409);
  });

  it("removes an unused spare state and renumbers the rest densely", () => {
    const project = createProject(db, owner, { name: "P" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const spare = states.find((s) => s.category === "in_progress")!;
    withProject(db, owner, project.id, "state:delete", (tx) => deleteState(tx, spare.id));
    const after = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(after.map((s) => s.id)).not.toContain(spare.id);
    expect(after.map((s) => s.position)).toEqual(after.map((_, i) => i));
  });

  it("returns 404 for a state in another project", () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const theirs = createProject(db, owner, { name: "Theirs" });
    const foreign = withProject(db, owner, theirs.id, "state:read", (tx) => listStates(tx))[0]!;
    expect(status(() => withProject(db, owner, mine.id, "state:delete", (tx) => deleteState(tx, foreign.id)))).toBe(404);
  });
});

describe("rollback", () => {
  it("undoes both the state row and its activity row when the callback throws after createState", () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const before = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(() =>
      withProject(db, owner, project.id, "state:write", (tx) => {
        createState(tx, { name: "Blocked", category: "in_progress" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const after = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(after.map((s) => s.name)).toEqual(before.map((s) => s.name));
    const rows = db
      .select()
      .from(activityLogs)
      .all()
      .filter((r) => r.projectId === project.id && r.action === "state.created" && r.payload?.includes("Blocked"));
    expect(rows).toHaveLength(0);
  });
});
