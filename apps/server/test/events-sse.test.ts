import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { EventBus } from "../src/events/bus";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let outsider: Actor;
let bus: EventBus;
let app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> };
let projectId: string;
let otherProjectId: string;
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });

/** Reads decoded chunks until `match` is found or the deadline passes. */
async function readUntil(res: Response, match: string, timeoutMs = 2000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + timeoutMs;
  while (!seen.includes(match)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${match}; saw: ${seen}`);
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${match}; saw: ${seen}`);
    seen += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return seen;
}

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  outsider = seedUser(db, "outsider@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  otherProjectId = createProject(db, owner, { name: "Other" }).id;
  bus = new EventBus();
  app = makeTestApp(db, undefined, { bus, heartbeatMs: 50 }).app;
});

describe("GET /api/projects/:id/events", () => {
  it("authorizes before streaming: 401 anonymous, 404 non-member", async () => {
    const anon = await app.request(`${ORIGIN}/api/projects/${projectId}/events`);
    expect(anon.status).toBe(401);
    const stranger = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(outsider) });
    expect(stranger.status).toBe(404);
  });

  it("answers with an SSE content type and sends heartbeat comment frames", async () => {
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await readUntil(res, ":")).toContain(":");
  });

  it("delivers one project.changed for a mutation in that project and nothing for another's", async () => {
    const mine = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    const theirs = await app.request(`${ORIGIN}/api/projects/${otherProjectId}/events`, { headers: as(owner) });
    expect(bus.subscriberCount()).toBe(2);

    await app.request(`${ORIGIN}/api/projects/${projectId}/stories`, {
      method: "POST",
      headers: { ...as(owner), "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ title: "Ship it" }),
    });

    const seen = await readUntil(mine, "project.changed");
    expect(seen).toContain(projectId);
    expect(seen).not.toContain(otherProjectId);
    await theirs.body!.cancel();
  });

  it("drops the subscription when the client goes away", async () => {
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    await readUntil(res, ":");
    // readUntil cancels the reader, which aborts the stream.
    const deadline = Date.now() + 2000;
    while (bus.subscriberCount() !== 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(bus.subscriberCount()).toBe(0);
  });
});
