import { describe, expect, it } from "bun:test";
import { attachLabel, createEpic, listEpics, listLabels, moveEpic } from "../src/services/labels";
import { updateStory } from "../src/services/stories";
import { withProject } from "../src/db/tx";
import { makeTestApp, makeTestDb, seedProject, seedStory, seedUser } from "./harness";

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
