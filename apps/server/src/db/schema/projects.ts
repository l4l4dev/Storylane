import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, index, check } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["owner", "member", "viewer"] }).notNull(),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    // The primary key covers project→members; this covers "which projects is this user in".
    index("project_members_user").on(t.userId),
    check("project_members_role", sql`${t.role} in ('owner','member','viewer')`),
  ],
);
