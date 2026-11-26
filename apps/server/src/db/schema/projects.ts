import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, index, check } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * The built-in list lives in @storylane/core (packages/core/src/point-scale.ts) — re-exported
 * here for callers that already import from the schema module. DEFAULT_POINT_SCALE stays local:
 * drizzle-kit must see it as a literal to generate the column default.
 */
export { BUILT_IN_POINT_SCALES } from "@storylane/core";
/** Linear is the scale a new Tracker project starts on (corpus `articles/estimating_stories.md:13`). */
export const DEFAULT_POINT_SCALE = "0,1,2,3";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** Comma-separated ascending point values, exactly as Tracker stores it (core-model §2.2). */
    pointScale: text("point_scale").notNull().default(DEFAULT_POINT_SCALE),
    bugsAndChoresAreEstimatable: integer("bugs_and_chores_are_estimatable", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Weeks. 1-4 per the articles; the API bounds neither (core-model §9.6). */
    iterationLength: integer("iteration_length").notNull().default(1),
    /** ISO weekday, 1 = Monday. Tracker names the day; the name is a serialization concern. */
    weekStartDay: integer("week_start_day").notNull().default(1),
    /** YYYY-MM-DD wall date; its weekday must equal week_start_day (guard trigger). */
    startDate: text("start_date").notNull(),
    /** IANA zone. Iteration boundaries are midnight in this zone. */
    timeZone: text("time_zone").notNull().default("UTC"),
    velocityAveragedOver: integer("velocity_averaged_over").notNull().default(3),
    initialVelocity: integer("initial_velocity").notNull().default(10),
    numberOfDoneIterationsToShow: integer("number_of_done_iterations_to_show").notNull().default(4),
    automaticPlanning: integer("automatic_planning", { mode: "boolean" }).notNull().default(true),
    enableTasks: integer("enable_tasks", { mode: "boolean" }).notNull().default(true),
    showStoryPriority: integer("show_story_priority", { mode: "boolean" }).notNull().default(false),
    /** Bumped by every recordActivity; the activity row carries the value it produced. */
    version: integer("version").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    check("projects_iteration_length", sql`${t.iterationLength} between 1 and 4`),
    check("projects_week_start_day", sql`${t.weekStartDay} between 1 and 7`),
    check("projects_velocity_averaged_over", sql`${t.velocityAveragedOver} between 1 and 4`),
    check("projects_initial_velocity", sql`${t.initialVelocity} >= 0`),
    check("projects_done_iterations_shown", sql`${t.numberOfDoneIterationsToShow} between 1 and 99`),
    check("projects_version", sql`${t.version} >= 0`),
    check("projects_point_scale_shape", sql`${t.pointScale} glob '[0-9]*' and ${t.pointScale} not glob '*[^0-9.,]*'`),
  ],
);

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
    /** Per-member project colour and favourite flag; their UI is step 8 (dashboard). */
    projectColor: text("project_color"),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    lastViewedAt: integer("last_viewed_at"),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user").on(t.userId),
    check("project_members_role", sql`${t.role} in ('owner','member','viewer')`),
  ],
);
