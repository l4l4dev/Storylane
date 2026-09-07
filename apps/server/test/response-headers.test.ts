import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestApp, makeTestDb, seedUser } from "./harness";

describe("baseline response headers", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-headers-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  const db = makeTestDb();
  seedUser(db, "owner@example.test");
  const { app } = makeTestApp(db, undefined, { staticRoot: dir });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("sets Referrer-Policy and X-Content-Type-Options on /healthz", async () => {
    const res = await app.request("/healthz");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets them on the SPA index too (an invite/reset link's token is in the path)", async () => {
    const res = await app.request("/invite/some-token");
    expect(res.status).toBe(200);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  // serveStatic returns a Response of its own rather than going through c.json — the headers
  // have to reach that one too.
  it("sets them on a statically served asset", async () => {
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
