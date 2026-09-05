import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, readPragmas } from "../src/db/client";

const paths: string[] = [];
afterAll(() => {
  for (const path of paths) {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
});

describe("openDatabase", () => {
  it("applies the required pragmas", () => {
    const db = openDatabase(":memory:");
    const p = readPragmas(db);
    // :memory: databases report journal_mode "memory"; the WAL assertion uses a file below
    expect(p.foreign_keys).toBe(1);
    expect(p.synchronous).toBe(1); // NORMAL
    expect(p.busy_timeout).toBe(5000);
    db.$client.close();
  });
  it("uses WAL for file databases", () => {
    const path = join(tmpdir(), `sl-test-${crypto.randomUUID()}.db`);
    paths.push(path);
    const db = openDatabase(path);
    expect(readPragmas(db).journal_mode).toBe("wal");
    db.$client.close();
  });
  it("enforces foreign keys", () => {
    const db = openDatabase(":memory:");
    db.$client.run("create table parent(id text primary key)");
    db.$client.run("create table child(id text primary key, parent_id text references parent(id))");
    expect(() => db.$client.run("insert into child values ('c1', 'missing')")).toThrow(/FOREIGN KEY/);
    db.$client.close();
  });
});
