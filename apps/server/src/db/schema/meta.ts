import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Instance-wide key/value rows (setup token hash, secret, settings). */
export const instanceMeta = sqliteTable("instance_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(), // UTC ms
});
