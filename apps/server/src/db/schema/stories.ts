import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  check,
  uniqueIndex,
  foreignKey,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projectMembers, projects } from "./projects";

export const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

/** Tracker's eight API values (core-model §1.2). `planned` needs manual planning. */
export const STORY_STATES = [
  "unscheduled",
  "unstarted",
  "planned",
  "started",
  "finished",
  "delivered",
  "accepted",
  "rejected",
] as const;
export type StoryState = (typeof STORY_STATES)[number];

export const STORY_PRIORITIES = ["none", "p0", "p1", "p2", "p3"] as const;
export type StoryPriority = (typeof STORY_PRIORITIES)[number];

/** Two ordered lists per project: "backlog" is Current + Backlog, cut by planning on read. */
export const STORY_LISTS = ["backlog", "icebox"] as const;
export type StoryList = (typeof STORY_LISTS)[number];

export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    storyType: text("story_type", { enum: STORY_TYPES }).notNull().default("feature"),
    currentState: text("current_state", { enum: STORY_STATES }).notNull().default("unscheduled"),
    /** Float because Tracker types it so; null = unestimated (the -1 sentinel is search-only). */
    estimate: real("estimate"),
    acceptedAt: integer("accepted_at"),
    /** Release stories only (guard trigger). */
    deadline: integer("deadline"),
    storyPriority: text("story_priority", { enum: STORY_PRIORITIES }).notNull().default("none"),
    list: text("list", { enum: STORY_LISTS }).notNull().default("icebox"),
    /** Sparse: moves renumber only around the target (services/ordering.ts). */
    position: integer("position").notNull(),
    requestedById: text("requested_by_id").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("stories_id_project").on(t.id, t.projectId),
    uniqueIndex("stories_project_number").on(t.projectId, t.number),
    uniqueIndex("stories_project_list_position").on(t.projectId, t.list, t.position),
    index("stories_project_state").on(t.projectId, t.currentState),
    index("stories_project_accepted").on(t.projectId, t.acceptedAt),
    check("stories_story_type", sql`${t.storyType} in ('feature','bug','chore','release')`),
    check(
      "stories_current_state",
      sql`${t.currentState} in ('unscheduled','unstarted','planned','started','finished','delivered','accepted','rejected')`,
    ),
    check("stories_story_priority", sql`${t.storyPriority} in ('none','p0','p1','p2','p3')`),
    check("stories_list", sql`${t.list} in ('backlog','icebox')`),
    check("stories_estimate_non_negative", sql`${t.estimate} is null or ${t.estimate} >= 0`),
  ],
);

export const storyOwners = sqliteTable(
  "story_owners",
  {
    projectId: text("project_id").notNull(),
    storyId: text("story_id").notNull(),
    userId: text("user_id").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.storyId, t.userId] }),
    index("story_owners_user").on(t.projectId, t.userId),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "story_owners_story_fk",
    }).onDelete("cascade"),
    // An owner must be a member of the story's own project; removal is handled by a trigger,
    // not ON DELETE SET NULL, because SQLite nulls every column of a composite child key.
    foreignKey({
      columns: [t.projectId, t.userId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
      name: "story_owners_member_fk",
    }),
  ],
);

export const storyFollowers = sqliteTable(
  "story_followers",
  {
    projectId: text("project_id").notNull(),
    storyId: text("story_id").notNull(),
    userId: text("user_id").notNull(),
    followedAt: integer("followed_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.storyId, t.userId] }),
    index("story_followers_user").on(t.projectId, t.userId),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "story_followers_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.userId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
      name: "story_followers_member_fk",
    }),
  ],
);
