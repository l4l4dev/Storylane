import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/client";
import { backupThenMigrate, runMigrations } from "../src/db/migrate";
import { createLogger } from "../src/log";

const silent = createLogger(() => {});

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sl-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("migrations", () => {
  it("creates instance_meta and is idempotent", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    runMigrations(db);
    const tables = db.$client.query("select name from sqlite_master where type='table' order by name").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("instance_meta");
    db.$client.close();
  });
  it("writes pre-<version>.db before migrating a file database", () => {
    const dir = tempDir();
    const db = openDatabase(join(dir, "storylane.db"));
    backupThenMigrate(db, { dataDir: dir, version: "0.1.0", log: silent });
    expect(existsSync(join(dir, "backups", "pre-0.1.0.db"))).toBe(true);
    expect(readdirSync(join(dir, "backups"))).toEqual(["pre-0.1.0.db"]);
    db.$client.close();
  });
  it("keeps the first backup when run again at the same version", () => {
    const dir = tempDir();
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));
    const db = openDatabase(join(dir, "storylane.db"));
    backupThenMigrate(db, { dataDir: dir, version: "0.1.0", log });
    backupThenMigrate(db, { dataDir: dir, version: "0.1.0", log });
    expect(readdirSync(join(dir, "backups"))).toEqual(["pre-0.1.0.db"]);
    expect(lines.filter((l) => l.includes("pre-migration backup exists, keeping it"))).toHaveLength(1);
    db.$client.close();
  });
  it("skips the backup for :memory:", () => {
    const db = openDatabase(":memory:");
    expect(() => backupThenMigrate(db, { dataDir: "/nonexistent", version: "0.1.0", log: silent })).not.toThrow();
    db.$client.close();
  });
});
