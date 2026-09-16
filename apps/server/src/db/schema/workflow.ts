import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projectMembers, projects } from "./projects";
import { stories } from "./stories";

/**
 * Free text that may name another story. blocking_story_id is that reference resolved at write
 * time, so accepting or deleting the referenced story can resolve the blocker (core-model §1.6)
 * without re-parsing prose.
 */
export const blockers = sqliteTable(
  "blockers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id").notNull(),
    blockingStoryId: text("blocking_story_id"),
    description: text("description").notNull(),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    personId: text("person_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("blockers_id_project").on(t.id, t.projectId),
    index("blockers_story").on(t.projectId, t.storyId),
    index("blockers_blocking").on(t.projectId, t.blockingStoryId),
    check("blockers_not_self", sql`${t.blockingStoryId} is null or ${t.blockingStoryId} <> ${t.storyId}`),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "blockers_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.blockingStoryId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "blockers_blocking_story_fk",
      // No ON DELETE: a composite SET NULL would null project_id with it. The
      // blockers_unlink_on_story_delete trigger clears the pointer instead.
    }),
  ],
);

export const reviewTypes = sqliteTable(
  "review_types",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Tracker never deletes a review type; hiding removes it from the menu (core-model §1.7). */
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("review_types_id_project").on(t.id, t.projectId),
    uniqueIndex("review_types_project_name").on(t.projectId, sql`${t.name} COLLATE NOCASE`),
    uniqueIndex("review_types_project_position").on(t.projectId, t.position),
  ],
);

export const REVIEW_STATUSES = ["unstarted", "in_review", "pass", "revise"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id").notNull(),
    reviewTypeId: text("review_type_id").notNull(),
    reviewerId: text("reviewer_id"),
    status: text("status", { enum: REVIEW_STATUSES }).notNull().default("unstarted"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("reviews_id_project").on(t.id, t.projectId),
    uniqueIndex("reviews_story_type_reviewer").on(t.projectId, t.storyId, t.reviewTypeId, t.reviewerId),
    index("reviews_reviewer").on(t.projectId, t.reviewerId),
    check("reviews_status", sql`${t.status} in ('unstarted','in_review','pass','revise')`),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "reviews_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.reviewTypeId, t.projectId],
      foreignColumns: [reviewTypes.id, reviewTypes.projectId],
      name: "reviews_type_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.projectId, t.reviewerId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
      name: "reviews_reviewer_member_fk",
    }),
  ],
);
