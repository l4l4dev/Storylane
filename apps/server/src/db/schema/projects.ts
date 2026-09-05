import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, unique, check } from "drizzle-orm/sqlite-core";
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
    check("project_members_role", sql`${t.role} in ('owner','member','viewer')`),
  ],
);

/** Every project-scoped table exposes these two columns so loadInProject can address it. */
export const scopedColumns = { id: text("id").primaryKey(), projectId: text("project_id").notNull() };

/** Scaffold table used by the tx tests; real domain tables replace it in phase 1. */
export const scopedItems = sqliteTable(
  "scoped_items",
  {
    ...scopedColumns,
    position: integer("position").notNull(),
    label: text("label").notNull(),
  },
  (t) => [
    unique("scoped_items_id_project").on(t.id, t.projectId),
    unique("scoped_items_position").on(t.projectId, t.position),
  ],
);
