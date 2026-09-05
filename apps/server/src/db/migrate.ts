import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vacuumInto } from "./backup";
import type { Db } from "./client";
import type { Logger } from "../log";

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}

export function backupThenMigrate(db: Db, opts: { dataDir: string; version: string; log: Logger }): void {
  const isFile = db.$client.filename !== "" && db.$client.filename !== ":memory:";
  if (isFile) {
    const target = join(opts.dataDir, "backups", `pre-${opts.version}.db`);
    if (existsSync(target)) {
      opts.log.info("pre-migration backup exists, keeping it", { path: target });
    } else {
      vacuumInto(db, target);
      opts.log.info("pre-migration backup written", { path: target });
    }
  }
  runMigrations(db);
  opts.log.info("migrations applied");
}
