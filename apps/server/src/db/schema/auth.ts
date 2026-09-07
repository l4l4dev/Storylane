import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    disabledAt: integer("disabled_at"),
    /**
     * Generation marker: a session row whose created_at predates this is refused even though the
     * revoke's DELETE missed it (a login INSERT in flight during a password change).
     */
    credentialsChangedAt: integer("credentials_changed_at"),
  },
  (t) => [uniqueIndex("users_email_nocase").on(sql`${t.email} COLLATE NOCASE`)],
);
