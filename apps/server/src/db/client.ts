import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function openDatabase(path: string): Db {
  const client = new Database(path, { create: true, strict: true });
  client.run("PRAGMA journal_mode = WAL");
  client.run("PRAGMA synchronous = NORMAL");
  client.run("PRAGMA foreign_keys = ON");
  client.run("PRAGMA busy_timeout = 5000");
  return drizzle({ client, schema });
}

export function readPragmas(db: Db) {
  const one = <T>(sql: string) => db.$client.query(sql).get() as T;
  return {
    journal_mode: one<{ journal_mode: string }>("PRAGMA journal_mode").journal_mode,
    synchronous: one<{ synchronous: number }>("PRAGMA synchronous").synchronous,
    foreign_keys: one<{ foreign_keys: number }>("PRAGMA foreign_keys").foreign_keys,
    busy_timeout: one<{ timeout: number }>("PRAGMA busy_timeout").timeout,
  };
}
