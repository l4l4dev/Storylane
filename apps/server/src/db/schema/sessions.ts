import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projects } from "./projects";

/** id is the SHA-256 hex of the session secret; the clear value lives only in the cookie. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    idleExpiresAt: integer("idle_expires_at").notNull(),
    absoluteExpiresAt: integer("absolute_expires_at").notNull(),
  },
  (t) => [
    index("sessions_user").on(t.userId),
    index("sessions_absolute").on(t.absoluteExpiresAt),
    // purgeExpiredSessions sweeps on either expiry, so both need an index.
    index("sessions_idle").on(t.idleExpiresAt),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role", { enum: ["owner", "member", "viewer"] }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    acceptedBy: text("accepted_by").references(() => users.id),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    uniqueIndex("invites_token_hash").on(t.tokenHash),
    // loadInProject addresses rows by (id, project_id); every project-scoped table carries it.
    uniqueIndex("invites_id_project").on(t.id, t.projectId),
    index("invites_project").on(t.projectId),
    check("invites_role", sql`${t.role} in ('owner','member','viewer')`),
  ],
);

export const resetTokens = sqliteTable(
  "reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [uniqueIndex("reset_tokens_token_hash").on(t.tokenHash), index("reset_tokens_user").on(t.userId)],
);
