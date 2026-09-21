import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { epics } from "../src/db/schema";
import { attachLabel, createEpic, listEpics, listLabels, moveEpic, updateEpic } from "../src/services/labels";
import { listActivity } from "../src/services/activity";
import { updateStory } from "../src/services/stories";
import { withProject } from "../src/db/tx";
import { makeTestApp, makeTestDb, seedEpic, seedProject, seedStory, seedUser } from "./harness";

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = seedProject(db, owner);
  return { db, owner, projectId };
}

describe("createEpic / moveEpic", () => {
  it("mints a label named after the epic when none is given", () => {
    const { db, owner, projectId } = setup();
    const epic = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
    const labels = withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx));
    expect(labels.map((l) => l.id)).toContain(epic.label_id);
    expect(labels.find((l) => l.id === epic.label_id)!.name).toBe("onboarding");
  });

  it("refuses a second epic on the same label", () => {
    const { db, owner, projectId } = setup();
    const first = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
    expect(() =>
      withProject(db, owner, projectId, "epic:write", (tx) =>
        createEpic(tx, { name: "Other", label_name: "onboarding" }),
      ),
    ).toThrow(/label_backs_an_epic/);
    expect(first.position).toBe(0);
  });

  it("reports progress from the accepted stories carrying its label", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 5 });
    withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
    withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "onboarding"));
    withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, storyId, { current_state: "accepted" }));
    const [read] = withProject(db, owner, projectId, "story:read", (tx) => listEpics(tx));
    expect(read!.past_done_stories_count).toBe(1);
    expect(read!.past_done_story_estimates).toBe(5);
    expect(read!.completed_at).not.toBeNull();
  });

  it("reorders epics with before_id/after_id and keeps positions dense", () => {
    const { db, owner, projectId } = setup();
    const a = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "A" }));
    const b = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "B" }));
    const order = withProject(db, owner, projectId, "epic:write", (tx) => moveEpic(tx, b.id, { before_id: a.id }));
    expect(order.map((e) => e.name)).toEqual(["B", "A"]);
    expect(order.map((e) => e.position)).toEqual([0, 1]);
  });

  it("writes no epic_move_activity when moveEpic is a no-op", () => {
    const { db, owner, projectId } = setup();
    const only = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Solo" }));
    withProject(db, owner, projectId, "epic:write", (tx) => moveEpic(tx, only.id, { after_id: null }));
    withProject(db, owner, projectId, "epic:write", (tx) => moveEpic(tx, only.id, {}));
    const moves = withProject(db, owner, projectId, "story:read", (tx) =>
      listActivity(tx, {}).filter((a) => a.kind === "epic_move_activity"),
    );
    expect(moves).toHaveLength(0);
  });

  it("writes exactly one epic_move_activity for a real move", () => {
    const { db, owner, projectId } = setup();
    const a = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "A" }));
    const b = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "B" }));
    withProject(db, owner, projectId, "epic:write", (tx) => moveEpic(tx, b.id, { before_id: a.id }));
    const moves = withProject(db, owner, projectId, "story:read", (tx) =>
      listActivity(tx, {}).filter((a) => a.kind === "epic_move_activity"),
    );
    expect(moves).toHaveLength(1);
  });
});

describe("epic routes", () => {
  it("creates an epic via POST and reorders via PUT with before_id", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const headers = { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) };
    const createA = await app.request(`/api/projects/${projectId}/epics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "A" }),
    });
    expect(createA.status).toBe(201);
    const a = (await createA.json()) as { id: string };
    const createB = await app.request(`/api/projects/${projectId}/epics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "B" }),
    });
    const b = (await createB.json()) as { id: string };
    const move = await app.request(`/api/projects/${projectId}/epics/${b.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ before_id: a.id }),
    });
    expect(move.status).toBe(200);
    const order = (await move.json()) as { name: string }[];
    expect(order.map((e) => e.name)).toEqual(["B", "A"]);
  });
});

describe("epic PUT and names", () => {
  const headersOf = (actor: unknown) => ({ "content-type": "application/json", "x-test-actor": JSON.stringify(actor) });

  it("applies name and description together with a move, and returns the renamed order", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const e1 = seedEpic(db, projectId, "E1");
    const e2 = seedEpic(db, projectId, "E2");
    const res = await app.request(`/api/projects/${projectId}/epics/${e2}`, {
      method: "PUT",
      headers: headersOf(owner),
      body: JSON.stringify({ name: "Renamed", description: "moved up", before_id: e1 }),
    });
    expect(res.status).toBe(200);
    const order = (await res.json()) as { id: string; name: string; description: string | null }[];
    expect(order.map((e) => [e.id, e.name])).toEqual([
      [e2, "Renamed"],
      [e1, "E1"],
    ]);
    expect(order[0]!.description).toBe("moved up");
    const kinds = withProject(db, owner, projectId, "story:read", (tx) => listActivity(tx, {})).map((a) => a.kind);
    expect(kinds.sort()).toEqual(["epic_move_activity", "epic_update_activity"]);
  });

  it("answers 400 name_required for a blank epic name or label_name, and trims both", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    for (const payload of [{ name: "" }, { name: "   " }, { name: "Ok", label_name: "  " }]) {
      const res = await app.request(`/api/projects/${projectId}/epics`, {
        method: "POST",
        headers: headersOf(owner),
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "name_required" });
    }
    const res = await app.request(`/api/projects/${projectId}/epics`, {
      method: "POST",
      headers: headersOf(owner),
      body: JSON.stringify({ name: " Billing ", label_name: " billing " }),
    });
    expect(res.status).toBe(201);
    const epic = (await res.json()) as { name: string; label_id: string };
    expect(epic.name).toBe("Billing");
    const label = withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx)).find((l) => l.id === epic.label_id);
    expect(label?.name).toBe("billing");
  });

  it("writes nothing when an epic update repeats the current values", () => {
    const { db, owner, projectId } = setup();
    const epicId = seedEpic(db, projectId, "Same");
    const before = db.select().from(epics).where(eq(epics.id, epicId)).get()!;
    withProject(db, owner, projectId, "epic:write", (tx) => updateEpic(tx, epicId, { name: "Same", description: null }));
    expect(db.select().from(epics).where(eq(epics.id, epicId)).get()!.updatedAt).toBe(before.updatedAt);
    expect(withProject(db, owner, projectId, "story:read", (tx) => listActivity(tx, {}))).toEqual([]);
  });
});

describe("epic PUT answers 404 before body validation", () => {
  it("answers 404 for an unknown epic with a blank name", async () => {
    const { db, owner, projectId } = setup();
    const { app } = makeTestApp(db);
    const res = await app.request(`/api/projects/${projectId}/epics/00000000-0000-0000-0000-000000000000`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-actor": JSON.stringify(owner) },
      body: JSON.stringify({ name: " " }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
