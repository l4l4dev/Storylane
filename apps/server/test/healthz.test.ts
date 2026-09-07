import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { createLogger } from "../src/log";
import { loadConfig } from "../src/config";
import { makeTestDb, seedUser } from "./harness";

function build(health: () => boolean) {
  const lines: string[] = [];
  const log = createLogger((l) => lines.push(l));
  const db = makeTestDb();
  // Seeded so the setup gate (TASK-248) does not turn /api/* requests into 409 setup_required.
  seedUser(db, "owner@example.test");
  const app = createApp({ config: loadConfig({}), log, health, db });
  return { app, lines };
}

describe("GET /healthz", () => {
  it("returns 200 with status ok when healthy", async () => {
    const { app } = build(() => true);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
  it("returns 503 when the health check fails", async () => {
    const { app } = build(() => false);
    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });
  it("logs one JSON line per request with method, path, status, duration, request id", async () => {
    const { app, lines } = build(() => true);
    await app.request("/healthz");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: "info", msg: "request", method: "GET", path: "/healthz", status: 200 });
    expect(typeof entry.duration_ms).toBe("number");
    expect(typeof entry.request_id).toBe("string");
    expect(typeof entry.ts).toBe("string");
  });
  it("answers unknown /api paths with JSON 404", async () => {
    const { app } = build(() => true);
    const res = await app.request("/api/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
