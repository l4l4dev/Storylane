import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { projects } from "./projects";
import { users } from "./auth";

/**
 * One row per user action (core-model §5). `changes` is a JSON array of
 * { kind, id, change_type, original_values, new_values }; `primary_resources` and
 * `secondary_resources` are JSON arrays. None of them is ever used in a WHERE — activity_resources
 * is the queryable projection.
 */
export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The projects.version this action produced; guid is "<project_id>_<project_version>". */
    projectVersion: integer("project_version").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    highlight: text("highlight").notNull(),
    changes: text("changes").notNull(),
    primaryResources: text("primary_resources").notNull(),
    secondaryResources: text("secondary_resources"),
    performedById: text("performed_by_id").references(() => users.id),
    occurredAt: integer("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("activities_id_project").on(t.id, t.projectId),
    // The resync primitive: GET /activity?since_version=N is a range scan on this.
    uniqueIndex("activities_project_version").on(t.projectId, t.projectVersion),
    index("activities_project_occurred").on(t.projectId, t.occurredAt),
    check("activities_kind_suffix", sql`${t.kind} like '%\\_activity' escape '\\'`),
  ],
);

export const ACTIVITY_RESOURCE_ROLES = ["primary", "secondary"] as const;

/** Queryable projection of primary/secondary resources: per-story and per-epic activity views. */
export const activityResources = sqliteTable(
  "activity_resources",
  {
    activityId: text("activity_id").notNull(),
    projectId: text("project_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    role: text("role", { enum: ACTIVITY_RESOURCE_ROLES }).notNull(),
  },
  (t) => [
    uniqueIndex("activity_resources_unique").on(t.activityId, t.resourceKind, t.resourceId, t.role),
    index("activity_resources_lookup").on(t.projectId, t.resourceKind, t.resourceId),
    check("activity_resources_role", sql`${t.role} in ('primary','secondary')`),
    foreignKey({
      columns: [t.activityId, t.projectId],
      foreignColumns: [activities.id, activities.projectId],
      name: "activity_resources_activity_fk",
    }).onDelete("cascade"),
  ],
);
