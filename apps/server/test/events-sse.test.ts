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
const json = (actor: Actor) => ({ ...as(actor), "content-type": "application/json", origin: ORIGIN });

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

/** Reads for a fixed window (never blocks past it) and returns the complete SSE frames seen. */
async function collectFrames(res: Response, windowMs: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const raced = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
    ]);
    if (raced === null || raced.done) break;
    if (raced.value) buf += decoder.decode(raced.value, { stream: true });
  }
  await reader.cancel();
  return buf.split("\n\n").filter((f) => f.length > 0);
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

  it("delivers exactly one project.changed frame for a mutation in that project and nothing for another's", async () => {
    const mine = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    const theirs = await app.request(`${ORIGIN}/api/projects/${otherProjectId}/events`, { headers: as(owner) });
    expect(bus.subscriberCount()).toBe(2);

    await app.request(`${ORIGIN}/api/projects/${projectId}`, {
      method: "PUT",
      headers: json(owner),
      body: JSON.stringify({ name: "Ship it" }),
    });

    const frames = await collectFrames(mine, 300);
    const changed = frames.filter((f) => f.includes("project.changed"));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain(projectId);
    expect(changed[0]).not.toContain(otherProjectId);
    // The version the change produced: a client may fetch activity?since_version= from here
    // instead of refetching the whole project. createProject already recorded version 2 (the
    // seeded review types, then the project itself).
    expect(changed[0]).toContain('"version":3');
    await theirs.body!.cancel();
  });

  it("publishes nothing on a 400: an invalid body never reaches withProjectChange's publish call", async () => {
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    const invalid = await app.request(`${ORIGIN}/api/projects/${projectId}`, {
      method: "PUT",
      headers: json(owner),
      body: JSON.stringify({ point_scale: "bogus" }),
    });
    expect(invalid.status).toBe(400);
    const frames = await collectFrames(res, 200);
    expect(frames.filter((f) => f.includes("project.changed"))).toHaveLength(0);
  });

  it("publishes nothing on a 409: an archived-project write is rejected before the callback runs", async () => {
    // Archived outside the connection under test, so its own (legitimate) publish doesn't
    // confound the count below.
    const archived = await app.request(`${ORIGIN}/api/projects/${projectId}/archive`, {
      method: "POST",
      headers: json(owner),
      body: "{}",
    });
    expect(archived.status).toBe(200);

    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    const conflicted = await app.request(`${ORIGIN}/api/projects/${projectId}`, {
      method: "PUT",
      headers: json(owner),
      body: JSON.stringify({ name: "nope" }),
    });
    expect(conflicted.status).toBe(409);
    const frames = await collectFrames(res, 200);
    expect(frames.filter((f) => f.includes("project.changed"))).toHaveLength(0);
  });

  it("drops the subscription when the client goes away", async () => {
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    await readUntil(res, ":");
    // readUntil cancels the reader, which aborts the stream.
    const deadline = Date.now() + 2000;
    while (bus.subscriberCount() !== 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(bus.subscriberCount()).toBe(0);
  });

  it("drops the subscription when the raw request signal aborts without the reader cancelling", async () => {
    const controller = new AbortController();
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, {
      headers: as(owner),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(bus.subscriberCount()).toBe(1);
    // Aborts the request signal directly, without ever calling reader.cancel() on the body —
    // the loop's own onAbort path is not exercised here, only the raw-signal listener.
    controller.abort();
    const deadline = Date.now() + 2000;
    while (bus.subscriberCount() !== 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(bus.subscriberCount()).toBe(0);
    await res.body?.cancel();
  });

  it("clears the pending heartbeat timer once the stream closes (no dead timers)", async () => {
    const live = new Set<ReturnType<typeof setTimeout>>();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const id = realSetTimeout(
        (...a: unknown[]) => {
          live.delete(id);
          fn(...a);
        },
        ms,
        ...args,
      );
      live.add(id);
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
      if (id !== undefined) live.delete(id as ReturnType<typeof setTimeout>);
      return realClearTimeout(id);
    }) as typeof clearTimeout;
    try {
      const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
      await readUntil(res, ":");
      const deadline = Date.now() + 500;
      while (live.size !== 0 && Date.now() < deadline) await Bun.sleep(10);
      expect(live.size).toBe(0);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });

  it("rejects the connection past the per-user stream cap, before subscribing", async () => {
    const capped = makeTestApp(db, undefined, { bus, heartbeatMs: 50, maxStreamsPerUser: 2 }).app;
    const first = await capped.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    const second = await capped.request(`${ORIGIN}/api/projects/${otherProjectId}/events`, { headers: as(owner) });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(bus.subscriberCount()).toBe(2);

    const third = await capped.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    expect(third.status).toBe(503);
    expect(await third.json()).toEqual({ error: "too_many_streams" });
    // The rejected request never reaches bus.subscribe.
    expect(bus.subscriberCount()).toBe(2);

    await first.body!.cancel();
    await second.body!.cancel();
  });
});
