import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { OrderedTable } from "../src/db/tx";

/**
 * Stand-in for a phase-1 project-scoped table. It exists only in test databases
 * (created by makeTestDb), never in a migration.
 */
export const scopedItems = sqliteTable("scoped_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  position: integer("position").notNull(),
  label: text("label").notNull(),
}) satisfies OrderedTable;

export const CREATE_SCOPED_ITEMS: readonly string[] = [
  `CREATE TABLE scoped_items (
     id text PRIMARY KEY NOT NULL,
     project_id text NOT NULL,
     position integer NOT NULL,
     label text NOT NULL
   )`,
  `CREATE UNIQUE INDEX scoped_items_id_project ON scoped_items (id, project_id)`,
  `CREATE UNIQUE INDEX scoped_items_position ON scoped_items (project_id, position)`,
];
