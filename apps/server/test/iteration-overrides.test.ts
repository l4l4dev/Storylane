import { describe, expect, it } from "bun:test";
import { deleteIterationOverride, listIterationOverrides, putIterationOverride } from "../src/services/iterations";
import { listActivity } from "../src/services/activity";
import { withProject } from "../src/db/tx";
import { makeTestApp, makeTestDb, seedProject, seedUser } from "./harness";

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = seedProject(db, owner);
  return { db, owner, projectId };
}

describe("putIterationOverride / listIterationOverrides / deleteIterationOverride", () => {
  it("upserts by number rather than creating a second row", () => {
    const { db, owner, projectId } = setup();
    withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 3, { length: 2 }));
    const row = withProject(db, owner, projectId, "iteration:override", (tx) =>
      putIterationOverride(tx, 3, { team_strength: 0.5 }),
    );
    expect(row).toEqual({ number: 3, length: 2, team_strength: 0.5 });
    expect(withProject(db, owner, projectId, "iteration:read", (tx) => listIterationOverrides(tx))).toHaveLength(1);
  });

  it("accepts a length of 1 to 99 and refuses anything else", () => {
    const { db, owner, projectId } = setup();
    expect(() =>
      withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 1, { length: 99 })),
    ).not.toThrow();
    expect(() =>
      withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 2, { length: 100 })),
    ).toThrow(/length_invalid/);
  });

  it("treats a null length as back to the project default", () => {
    const { db, owner, projectId } = setup();
    withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 4, { length: 3 }));
    const row = withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 4, { length: null }));
    expect(row.length).toBeNull();
  });

  it("refuses iteration number zero and negatives", () => {
    const { db, owner, projectId } = setup();
    expect(() =>
      withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 0, { length: 1 })),
    ).toThrow(/iteration_number_invalid/);
    expect(() =>
      withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, -1, { length: 1 })),
    ).toThrow(/iteration_number_invalid/);
  });

  it("records the activity Tracker records, with 'default' as the pre-override length", () => {
    const { db, owner, projectId } = setup();
    withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 5, { length: 2 }));
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    const last = rows[rows.length - 1]!;
    expect(last.kind).toBe("iteration_update_activity");
    expect(last.changes[0]!.kind).toBe("iteration_override");
    expect(last.changes[0]!.original_values).toEqual({ number: 5, length: "default", team_strength: 1 });
    expect(last.changes[0]!.new_values).toEqual({ number: 5, length: 2, team_strength: 1 });
  });

  it("refuses a length of 0, a fraction, or 100", () => {
    const { db, owner, projectId } = setup();
    for (const length of [0, 100, 1.5]) {
      expect(() =>
        withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 6, { length })),
      ).toThrow(/length_invalid/);
    }
  });

  it("refuses a team_strength outside 0..10", () => {
    const { db, owner, projectId } = setup();
    for (const team_strength of [-0.1, 10.1, NaN]) {
      expect(() =>
        withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 7, { team_strength })),
      ).toThrow(/team_strength_invalid/);
    }
  });

  it("refuses a patch with neither length nor team_strength", () => {
    const { db, owner, projectId } = setup();
    expect(() =>
      withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 8, {})),
    ).toThrow(/override_empty/);
  });

  it("writes no activity for a no-op PUT", () => {
    const { db, owner, projectId } = setup();
    withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 9, { length: 2 }));
    const before = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 9, { length: 2 }));
    const after = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    expect(after).toHaveLength(before.length);
  });

  it("writes no activity for a no-op PUT of defaults with no row present", () => {
    const { db, owner, projectId } = setup();
    const before = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    const row = withProject(db, owner, projectId, "iteration:override", (tx) =>
      putIterationOverride(tx, 10, { length: null, team_strength: 1 }),
    );
    expect(row).toEqual({ number: 10, length: null, team_strength: 1 });
    const after = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    expect(after).toHaveLength(before.length);
    expect(withProject(db, owner, projectId, "iteration:read", (tx) => listIterationOverrides(tx))).toHaveLength(0);
  });

  it("deleting an override that does not exist writes no activity", () => {
    const { db, owner, projectId } = setup();
    const before = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    withProject(db, owner, projectId, "iteration:override", (tx) => deleteIterationOverride(tx, 11));
    const after = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    expect(after).toHaveLength(before.length);
  });

  it("deleting an override writes the reset activity", () => {
    const { db, owner, projectId } = setup();
    withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 12, { length: 5, team_strength: 3 }));
    withProject(db, owner, projectId, "iteration:override", (tx) => deleteIterationOverride(tx, 12));
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    const last = rows[rows.length - 1]!;
    expect(last.kind).toBe("iteration_update_activity");
    expect(last.changes[0]!.kind).toBe("iteration_override");
    expect(last.changes[0]!.original_values).toEqual({ number: 12, length: 5, team_strength: 3 });
    expect(last.changes[0]!.new_values).toEqual({ number: 12, length: "default", team_strength: 1 });
    expect(withProject(db, owner, projectId, "iteration:read", (tx) => listIterationOverrides(tx))).toHaveLength(0);
  });
});

describe("iteration override routes", () => {
  it("refuses every invalid :number form with 400 iteration_number_invalid", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };
    for (const bad of ["3abc", "0", "-1", "1.5", "", "1e2"]) {
      const res = await app.request(`/api/projects/${projectId}/iteration_overrides/${encodeURIComponent(bad)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ length: 2 }),
      });
      expect(res.status).toBe(bad === "" ? 404 : 400);
      if (bad !== "") expect((await res.json()) as { error: string }).toEqual({ error: "iteration_number_invalid" });
    }
  });

  it("a viewer's PUT is 403", async () => {
    const { db, owner } = setup();
    const viewer = seedUser(db, "viewer@example.test");
    const projectId = seedProject(db, owner, [[viewer, "viewer"]]);
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/iteration_overrides/2`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-actor": JSON.stringify(viewer) },
      body: JSON.stringify({ length: 2 }),
    });
    expect(res.status).toBe(403);
  });

  it("a non-member's PUT with an invalid :number answers 404, not 400 — authorization runs first", async () => {
    const { db, projectId } = setup();
    const outsider = seedUser(db, "outsider@example.test");
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/iteration_overrides/not-a-number`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-actor": JSON.stringify(outsider) },
      body: JSON.stringify({ length: 2 }),
    });
    expect(res.status).toBe(404);
  });

  it("a PUT with an empty body answers 400 override_empty", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/iteration_overrides/2`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "override_empty" });
  });

  it("PUT is idempotent across actors: the second identical PUT by another member is a no-op and still 200", async () => {
    const { db, owner } = setup();
    const member = seedUser(db, "member@example.test");
    const projectId = seedProject(db, owner, [[member, "member"]]);
    const { app } = makeTestApp(db);
    const ownerHeaders = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };
    const memberHeaders = { "content-type": "application/json", "x-test-actor": JSON.stringify(member) };
    const first = await app.request(`/api/projects/${projectId}/iteration_overrides/2`, {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({ length: 4 }),
    });
    expect(first.status).toBe(200);
    const second = await app.request(`/api/projects/${projectId}/iteration_overrides/2`, {
      method: "PUT",
      headers: memberHeaders,
      body: JSON.stringify({ length: 4 }),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ number: 2, length: 4, team_strength: 1 });
  });

  it("DELETE of a missing override answers 204", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/iteration_overrides/9`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) },
    });
    expect(res.status).toBe(204);
  });
});
