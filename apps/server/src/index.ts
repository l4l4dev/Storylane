import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";
import { loadConfig, ConfigError, type Config } from "./config";
import { createLogger } from "./log";
import { createApp } from "./app";
import { openDatabase } from "./db/client";
import { backupThenMigrate } from "./db/migrate";
import { vacuumInto } from "./db/backup";
import { actorFromRequest } from "./auth/actor";
import { purgeExpiredSessions } from "./auth/sessions";
import { ensureSetupToken } from "./setup/setup-token";
import { EventBus } from "./events/bus";

const [command = "serve", ...args] = Bun.argv.slice(2);
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

if (command === "serve") {
  const config = loadConfigOrExit();
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, "storylane.db"));
  try {
    backupThenMigrate(db, { dataDir: config.dataDir, version: pkg.version, log });
  } catch (e) {
    log.error("migration failed; restore backups/pre-<version>.db if needed", { message: (e as Error).message });
    process.exit(1);
  }
  ensureSetupToken(db, log);
  const purge = () => log.info("sessions purged", { count: purgeExpiredSessions(db) });
  purge();
  // Dead rows are already refused by resolveSession; this only keeps the table from growing.
  // unref'd so the sweep never holds the process open on its own.
  setInterval(purge, 60 * 60 * 1000).unref();
  const bus = new EventBus();
  const app = createApp({
    config,
    log,
    db,
    bus,
    actorOf: actorFromRequest(db),
    testActorHeader: false,
    health: () => {
      try {
        db.$client.query("select 1").get();
        return true;
      } catch {
        return false;
      }
    },
  });
  Bun.serve({ port: config.port, hostname: "0.0.0.0", fetch: app.fetch });
  log.info("listening", { port: config.port, data_dir: config.dataDir, version: pkg.version });
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
