import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, index, check } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

export const POINT_SCALES = ["fibonacci", "linear", "custom"] as const;
export type PointScale = (typeof POINT_SCALES)[number];

/**
 * No table-level check() on point_scale, deliberately: `projects` shipped in 0001, and Drizzle
 * expresses a new CHECK on an existing SQLite table as a DROP/CREATE rebuild whose INSERT..SELECT
 * reads the not-yet-added columns — SQLite's double-quoted-identifier fallback turns those into
 * string literals rather than erroring, so the rebuild silently corrupts every existing row.
 * point_scale is guarded by the projects_point_scale_valid_{insert,update} triggers in 0003.
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  pointScale: text("point_scale", { enum: POINT_SCALES }).notNull().default("fibonacci"),
  /** JSON array of numbers, only read when pointScale === "custom" (never used in WHERE). */
  customPoints: text("custom_points"),
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
