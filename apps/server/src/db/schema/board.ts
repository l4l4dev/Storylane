import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projectMembers, projects } from "./projects";

/** The four system categories. Semantics attach to the category, never to a state's name. */
export const STATE_CATEGORIES = ["unstarted", "in_progress", "done", "rejected"] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

export const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export const projectStates = sqliteTable(
  "project_states",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Advance-button verb; null = this state offers no advance button. */
    actionLabel: text("action_label"),
    category: text("category", { enum: STATE_CATEGORIES }).notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("project_states_id_project").on(t.id, t.projectId),
    uniqueIndex("project_states_position").on(t.projectId, t.position),
    check("project_states_category", sql`${t.category} in ('unstarted','in_progress','done','rejected')`),
  ],
);

export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Per-project sequence, MAX+1 inside the transaction, pinned by a trigger afterwards. */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    storyType: text("story_type", { enum: STORY_TYPES }).notNull().default("feature"),
    /** null = Icebox. The category behind the state drives completed_at and zone semantics. */
    stateId: text("state_id"),
    position: integer("position").notNull(),
    points: integer("points"),
    requesterId: text("requester_id").references(() => users.id),
    assigneeId: text("assignee_id").references(() => users.id),
    completedAt: integer("completed_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("stories_id_project").on(t.id, t.projectId),
    uniqueIndex("stories_project_number").on(t.projectId, t.number),
    index("stories_project_state_position").on(t.projectId, t.stateId, t.position),
    check("stories_story_type", sql`${t.storyType} in ('feature','bug','chore','release')`),
    check("stories_points", sql`${t.points} is null or ${t.points} >= 0`),
    // A story can never point at another project's state, and a state in use cannot be deleted.
    foreignKey({
      columns: [t.stateId, t.projectId],
      foreignColumns: [projectStates.id, projectStates.projectId],
      name: "stories_state_project_fk",
    }).onDelete("restrict"),
    // The assignee must be a member of the story's own project (spec/data-model.md "stories").
    // Not ON DELETE SET NULL: SQLite nulls *every* column of a composite child key, which would
    // hit the NOT NULL project_id (the spec's column-restricted `SET NULL (assignee_id)` is a
    // Postgres-only form). The stories_unassign_on_member_removal trigger in 0003 does it instead.
    foreignKey({
      columns: [t.projectId, t.assigneeId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
      name: "stories_assignee_member_fk",
    }),
  ],
);
