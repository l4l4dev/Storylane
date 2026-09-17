import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";

/** The `Bun.serve` handle; this app registers no WebSocket handler. */
type HttpServer = Server<undefined>;
import pkg from "../package.json";
import { loadConfig, ConfigError, type Config } from "./config";
import { createLogger, type Logger } from "./log";
import { createApp } from "./app";
import { ATTACHMENT_MAX_BYTES } from "./attachments/store";
import { openDatabase } from "./db/client";
import { backupThenMigrate } from "./db/migrate";
import { vacuumInto } from "./db/backup";
import { actorFromRequest } from "./auth/actor";
import { purgeExpiredSessions } from "./auth/sessions";
import { purgeExpiredResetTokens } from "./services/reset";
import { purgeExpiredInvites } from "./services/invites";
import { ensureSetupToken } from "./setup/setup-token";
import { EventBus } from "./events/bus";

const log = createLogger();

function loadConfigOrExit(): Config {
  try {
    return loadConfig(Bun.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      log.error("config", { message: e.message });
      process.exit(2);
    }
    throw e;
  }
}

export interface StartServerOptions {
  /** Defaults to the process logger; the boot test injects a capturing one. */
  log?: Logger;
  /** Defaults to SSE_HEARTBEAT_MS; the boot test shortens it. */
  heartbeatMs?: number;
}

/**
 * The whole boot path, exported so a test can drive the real process end to end (backup +
 * migrate, setup token, purge schedule, server options) rather than only `app.fetch`. Returns
 * the `Bun.serve` handle: `server.port` (with `config.port` 0) and `server.stop(true)`.
 */
export function startServer(config: Config, opts: StartServerOptions = {}): HttpServer {
  const serverLog = opts.log ?? log;
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, "storylane.db"));
  try {
    backupThenMigrate(db, { dataDir: config.dataDir, version: pkg.version, log: serverLog });
  } catch (e) {
    serverLog.error("migration failed; restore backups/pre-<version>.db if needed", { message: (e as Error).message });
    throw e;
  }
  ensureSetupToken(db, serverLog);
  const purge = () => {
    serverLog.info("sessions purged", { count: purgeExpiredSessions(db) });
    // Dead rows are already refused by usable()/mintResetToken's own checks; this only keeps
    // the tables from growing.
    serverLog.info("reset tokens purged", { count: purgeExpiredResetTokens(db) });
    serverLog.info("invites purged", { count: purgeExpiredInvites(db) });
  };
  purge();
  // unref'd so the sweep never holds the process open on its own.
  setInterval(purge, 60 * 60 * 1000).unref();
  const bus = new EventBus();
  const app = createApp({
    config,
    log: serverLog,
    db,
    bus,
    actorOf: actorFromRequest(db),
    testActorHeader: false,
    ...(opts.heartbeatMs === undefined ? {} : { heartbeatMs: opts.heartbeatMs }),
    health: () => {
      try {
        db.$client.query("select 1").get();
        return true;
      } catch {
        return false;
      }
    },
  });
  const server = Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    // Bun's default is 10s, below SSE_HEARTBEAT_MS: a quiet stream would be closed between
    // heartbeats and the client would lose every event during the reconnect. 0 disables it.
    idleTimeout: 0,
    // Headroom over the attachment cap so an at-limit upload reaches the route's own 413/400 checks.
    maxRequestBodySize: ATTACHMENT_MAX_BYTES + 1024 * 1024,
    fetch: app.fetch,
  });
  serverLog.info("listening", { port: server.port, data_dir: config.dataDir, version: pkg.version, git_sha: config.gitSha });
  return server;
}

function main(): void {
  const [command = "serve", ...args] = Bun.argv.slice(2);
  if (command === "serve") {
    const config = loadConfigOrExit();
    try {
      const server = startServer(config);
      let shuttingDown = false;
      const shutdown = (signal: string) => {
        if (shuttingDown) {
          // A second signal means the operator wants out now, not after in-flight requests finish.
          log.info("shutdown forced", { signal });
          server.stop(true);
          process.exit(0);
        }
        shuttingDown = true;
        log.info("shutting down", { signal });
        server.stop().then(() => process.exit(0));
      };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    } catch {
      // startServer already logged what failed.
      process.exit(1);
    }
  } else if (command === "backup") {
    const [target] = args;
    if (!target) {
      log.error("usage: storylane backup <path>");
      process.exit(2);
    }
    const config = loadConfigOrExit();
    const db = openDatabase(join(config.dataDir, "storylane.db"));
    try {
      vacuumInto(db, target);
    } catch (e) {
      log.error("backup failed", { message: (e as Error).message });
      process.exit(1);
    }
    log.info("backup written", { path: target });
  } else {
    log.error("unknown command", { command });
    process.exit(2);
  }
}

if (import.meta.main) main();
