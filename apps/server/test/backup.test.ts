import { afterAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/client";
import { vacuumInto } from "../src/db/backup";
import { runMigrations } from "../src/db/migrate";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sl-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("vacuumInto", () => {
  it("produces a consistent copy with the same tables and rows", () => {
    const dir = tempDir();
    const db = openDatabase(join(dir, "live.db"));
    runMigrations(db);
    db.$client.run("insert into instance_meta(key, value, updated_at) values ('k', 'v', 1)");
    const target = join(dir, "copy.db");
    vacuumInto(db, target);
    const copy = new Database(target, { readonly: true });
    const row = copy.query("select value from instance_meta where key = 'k'").get() as { value: string };
    expect(row.value).toBe("v");
    copy.close();
    db.$client.close();
  });
  it("refuses to overwrite an existing file", () => {
    const dir = tempDir();
    const db = openDatabase(join(dir, "live.db"));
    const target = join(dir, "copy.db");
    vacuumInto(db, target);
    expect(() => vacuumInto(db, target)).toThrow(/exists/);
    db.$client.close();
  });
  it("replaces a stale .tmp file and leaves none behind", () => {
    const dir = tempDir();
    const db = openDatabase(join(dir, "live.db"));
    runMigrations(db);
    const target = join(dir, "copy.db");
    writeFileSync(`${target}.tmp`, "partial garbage from an interrupted run");
    vacuumInto(db, target);
    expect(existsSync(`${target}.tmp`)).toBe(false);
    const copy = new Database(target, { readonly: true });
    const tables = copy.query("select name from sqlite_master where type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("instance_meta");
    copy.close();
    db.$client.close();
  });
});
