import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { startServer } from "../src/index";
import { createLogger } from "../src/log";
import type { Config } from "../src/config";

/**
 * The one test that goes through the real entry point (Bun.serve, not app.fetch), so the boot
 * path itself is covered: migrate, setup token, purge schedule, and the server options — an SSE
 * stream living past a heartbeat is only true if `idleTimeout` was passed.
 */

const HEARTBEAT_MS = 300;

let server: Server<undefined> | null = null;
let dataDir: string | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
  if (dataDir !== null) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

function boot(): { base: string; lines: string[] } {
  dataDir = mkdtempSync(join(tmpdir(), "storylane-boot-"));
  const lines: string[] = [];
  // loadConfig refuses port 0 (it is not a port an operator may ask for); the test asks Bun for
  // an ephemeral one instead of racing a hardcoded number.
  const config: Config = { port: 0, dataDir, baseUrl: null, trustProxy: false, gitSha: "test-sha" };
  server = startServer(config, { log: createLogger((l) => lines.push(l)), heartbeatMs: HEARTBEAT_MS });
  return { base: `http://127.0.0.1:${server.port}`, lines };
}

function setupToken(lines: string[]): string {
  for (const line of lines) {
    const parsed = JSON.parse(line) as { msg: string; token?: string };
    if (parsed.msg === "setup token" && parsed.token) return parsed.token;
  }
  throw new Error(`no setup token in the boot log: ${lines.join("\n")}`);
}

it("serves /healthz over a real Bun.serve listener", async () => {
  const { base } = boot();
  const res = await fetch(`${base}/healthz`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

it("logs the version and git sha on boot", () => {
  const { lines } = boot();
  const listening = lines.map((l) => JSON.parse(l) as { msg: string; git_sha?: string }).find((l) => l.msg === "listening");
  expect(listening?.git_sha).toBe("test-sha");
});

it("logs a setup token and completes setup, then keeps an SSE stream open past the heartbeat", async () => {
  const { base, lines } = boot();
  const jsonHeaders = { "content-type": "application/json", origin: base };

  const setup = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      token: setupToken(lines),
      email: "owner@example.test",
      displayName: "Owner",
      password: "correct horse battery",
    }),
  });
  expect(setup.status).toBe(200);
  const cookie = setup.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();

  const created = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { ...jsonHeaders, cookie: cookie! },
    body: JSON.stringify({ name: "Boot" }),
  });
  expect(created.status).toBe(201);
  const project = (await created.json()) as { id: string };

  const controller = new AbortController();
  const stream = await fetch(`${base}/api/projects/${project.id}/events`, {
    headers: { cookie: cookie! },
    signal: controller.signal,
  });
  expect(stream.status).toBe(200);

  // Bun's default idleTimeout (10s) is longer than this window, so a wall-clock wait would not
  // discriminate: the assertion is that the stream survives several heartbeat intervals of
  // silence, which is the shape that breaks when idleTimeout < heartbeat.
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + HEARTBEAT_MS * 4;
  let ended = false;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const raced = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (raced === "timeout") break;
    if (raced.done) {
      ended = true;
      break;
    }
    seen += decoder.decode(raced.value, { stream: true });
  }
  expect(ended).toBe(false);
  expect(seen.split(": heartbeat").length - 1).toBeGreaterThanOrEqual(2);
  controller.abort();
}, 20_000);
