import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/client";
import { vacuumInto } from "../src/db/backup";
import { runMigrations } from "../src/db/migrate";

describe("vacuumInto", () => {
  it("produces a consistent copy with the same tables and rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-"));
    const db = openDatabase(join(dir, "live.db"));
    runMigrations(db);
    db.$client.run("insert into instance_meta(key, value, updated_at) values ('k', 'v', 1)");
    const target = join(dir, "copy.db");
    vacuumInto(db, target);
    const copy = new Database(target, { readonly: true });
    const row = copy.query("select value from instance_meta where key = 'k'").get() as { value: string };
    expect(row.value).toBe("v");
    copy.close();
  });
  it("refuses to overwrite an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-"));
    const db = openDatabase(join(dir, "live.db"));
    const target = join(dir, "copy.db");
    vacuumInto(db, target);
    expect(() => vacuumInto(db, target)).toThrow(/exists/);
  });
});
