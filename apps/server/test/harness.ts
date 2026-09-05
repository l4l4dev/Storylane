import { openDatabase, type Db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

export function makeTestDb(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}
