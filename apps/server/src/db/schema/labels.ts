import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  foreignKey,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { projects } from "./projects";
import { stories } from "./stories";

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("labels_id_project").on(t.id, t.projectId),
    uniqueIndex("labels_project_name").on(t.projectId, sql`${t.name} COLLATE NOCASE`),
  ],
);

export const storyLabels = sqliteTable(
  "story_labels",
  {
    projectId: text("project_id").notNull(),
    storyId: text("story_id").notNull(),
    labelId: text("label_id").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.storyId, t.labelId] }),
    index("story_labels_label").on(t.projectId, t.labelId),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "story_labels_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.labelId, t.projectId],
      foreignColumns: [labels.id, labels.projectId],
      name: "story_labels_label_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * An epic *has* a label (core-model §4.2): a story is in the epic exactly when it carries that
 * label, so there is no epic_id on stories. One label backs at most one epic.
 */
export const epics = sqliteTable(
  "epics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    labelId: text("label_id").notNull(),
    /** Dense 0..n-1 via reorder(); epics are a short list. */
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("epics_id_project").on(t.id, t.projectId),
    uniqueIndex("epics_project_label").on(t.projectId, t.labelId),
    uniqueIndex("epics_project_position").on(t.projectId, t.position),
    foreignKey({
      columns: [t.labelId, t.projectId],
      foreignColumns: [labels.id, labels.projectId],
      name: "epics_label_fk",
    }).onDelete("restrict"),
  ],
);
