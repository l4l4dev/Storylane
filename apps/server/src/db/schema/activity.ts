import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { projects } from "./projects";
import { users } from "./auth";

/**
 * Written only by services/activity.ts recordActivity(). story_id has no FK: this table
 * ships one migration before `stories` exists, so the composite (story_id, project_id)
 * guard is a trigger added in 0003 instead (a table rebuild is the only alternative under
 * forward-only migrations).
 */
export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id"),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    payload: text("payload"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("activity_logs_project_created").on(t.projectId, t.createdAt)],
);
