import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/client";
import { backupThenMigrate, runMigrations } from "../src/db/migrate";
import { createLogger } from "../src/log";

const silent = createLogger(() => {});

describe("migrations", () => {
  it("creates instance_meta and is idempotent", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    runMigrations(db);
    const tables = db.$client.query("select name from sqlite_master where type='table' order by name").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("instance_meta");
  });
  it("writes pre-<version>.db before migrating a file database", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-"));
    const db = openDatabase(join(dir, "storylane.db"));
    backupThenMigrate(db, { dataDir: dir, version: "0.1.0", log: silent });
    expect(existsSync(join(dir, "backups", "pre-0.1.0.db"))).toBe(true);
    expect(readdirSync(join(dir, "backups"))).toEqual(["pre-0.1.0.db"]);
  });
  it("skips the backup for :memory:", () => {
    const db = openDatabase(":memory:");
    expect(() => backupThenMigrate(db, { dataDir: "/nonexistent", version: "0.1.0", log: silent })).not.toThrow();
  });
});
