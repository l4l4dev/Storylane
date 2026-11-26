import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, check, primaryKey } from "drizzle-orm/sqlite-core";
import { projects } from "./projects";

/**
 * The only stored iteration data. Windows, numbers, points and velocity are computed on read
 * from the project calendar (design §3.2), so there is no iteration row to override — the key
 * is (project_id, number), not (id, project_id).
 *
 * length null = "default" (Tracker's own pre-override sentinel in the activity payload).
 */
export const iterationOverrides = sqliteTable(
  "iteration_overrides",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    length: integer("length"),
    teamStrength: real("team_strength").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.number] }),
    check("iteration_overrides_number", sql`${t.number} >= 1`),
    check("iteration_overrides_length", sql`${t.length} is null or ${t.length} between 1 and 99`),
    check("iteration_overrides_team_strength", sql`${t.teamStrength} >= 0 and ${t.teamStrength} <= 10`),
  ],
);
