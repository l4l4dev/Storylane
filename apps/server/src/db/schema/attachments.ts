import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projects } from "./projects";
import { stories } from "./stories";
import { epics } from "./labels";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id").notNull(),
    description: text("description").notNull(),
    complete: integer("complete", { mode: "boolean" }).notNull().default(false),
    /** Dense 0..n-1 within one story; Tracker serializes it 1-based. */
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("tasks_id_project").on(t.id, t.projectId),
    uniqueIndex("tasks_story_position").on(t.projectId, t.storyId, t.position),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "tasks_story_fk",
    }).onDelete("cascade"),
  ],
);

/** A comment hangs off exactly one of a story or an epic (core-model §7). */
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id"),
    epicId: text("epic_id"),
    /** NOT NULL but "" is legal: an attachment-only comment carries no text (core-model §7). */
    text: text("text").notNull(),
    personId: text("person_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("comments_id_project").on(t.id, t.projectId),
    index("comments_story").on(t.projectId, t.storyId, t.createdAt),
    index("comments_epic").on(t.projectId, t.epicId, t.createdAt),
    check("comments_one_parent", sql`(${t.storyId} is null) <> (${t.epicId} is null)`),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "comments_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.epicId, t.projectId],
      foreignColumns: [epics.id, epics.projectId],
      name: "comments_epic_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * Metadata only. The bytes live at $STORYLANE_DATA_DIR/attachments/<storage_path>; the column
 * holds a path relative to that directory so the data dir can move.
 */
export const fileAttachments = sqliteTable(
  "file_attachments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    commentId: text("comment_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storagePath: text("storage_path").notNull(),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id),
    width: integer("width"),
    height: integer("height"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("file_attachments_id_project").on(t.id, t.projectId),
    uniqueIndex("file_attachments_storage_path").on(t.storagePath),
    index("file_attachments_comment").on(t.projectId, t.commentId),
    check("file_attachments_size", sql`${t.size} >= 0`),
    foreignKey({
      columns: [t.commentId, t.projectId],
      foreignColumns: [comments.id, comments.projectId],
      name: "file_attachments_comment_fk",
    }).onDelete("cascade"),
  ],
);
