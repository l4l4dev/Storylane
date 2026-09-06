import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestApp, makeTestDb } from "./harness";

describe("static SPA serving", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  const { app } = makeTestApp(makeTestDb(), undefined, { staticRoot: dir });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("serves index.html at /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });
  it("serves assets", async () => {
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
  });
  it("falls back to index.html for unknown non-API paths", async () => {
    const res = await app.request("/projects/abc/board");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });
  it("keeps JSON 404 for unknown /api paths", async () => {
    const res = await app.request("/api/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
