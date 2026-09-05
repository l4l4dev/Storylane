import { describe, expect, it } from "bun:test";
import { openDatabase, readPragmas } from "../src/db/client";

describe("openDatabase", () => {
  it("applies the required pragmas", () => {
    const db = openDatabase(":memory:");
    const p = readPragmas(db);
    // :memory: databases report journal_mode "memory"; the WAL assertion uses a file below
    expect(p.foreign_keys).toBe(1);
    expect(p.synchronous).toBe(1); // NORMAL
    expect(p.busy_timeout).toBe(5000);
  });
  it("uses WAL for file databases", () => {
    const path = `/tmp/sl-test-${crypto.randomUUID()}.db`;
    const db = openDatabase(path);
    expect(readPragmas(db).journal_mode).toBe("wal");
    db.$client.close();
  });
  it("enforces foreign keys", () => {
    const db = openDatabase(":memory:");
    db.$client.run("create table parent(id text primary key)");
    db.$client.run("create table child(id text primary key, parent_id text references parent(id))");
    expect(() => db.$client.run("insert into child values ('c1', 'missing')")).toThrow(/FOREIGN KEY/);
  });
});
