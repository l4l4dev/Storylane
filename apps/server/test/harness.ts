import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createLogger } from "../src/log";
import { openDatabase, type Db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { projectMembers, projects, users } from "../src/db/schema";
import { CREATE_SCOPED_ITEMS } from "./scoped-items";
import type { Actor } from "../src/db/tx";

export function makeTestDb(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  // Not a migration: scoped_items is test scaffolding for the ProjectTx helpers.
  for (const stmt of CREATE_SCOPED_ITEMS) db.$client.run(stmt);
  return db;
}

export function seedUser(db: Db, email: string, isAdmin = false): Actor {
  const id = crypto.randomUUID();
  db.insert(users)
    .values({ id, email, passwordHash: "x", displayName: email.split("@")[0]!, isAdmin, createdAt: Date.now() })
    .run();
  return { kind: "user", userId: id, isAdmin };
}

/** Deactivates a seeded user (users.disabled_at). */
export function disableUser(db: Db, actor: Actor): void {
  if (actor.kind !== "user") throw new Error("expected a user actor");
  db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, actor.userId)).run();
}

export function seedProject(db: Db, owner: Actor, others: Array<[Actor, "member" | "viewer"]> = []): string {
  if (owner.kind !== "user") throw new Error("owner must be a user");
  const id = crypto.randomUUID();
  db.insert(projects).values({ id, name: "P", createdBy: owner.userId, createdAt: Date.now() }).run();
  db.insert(projectMembers).values({ projectId: id, userId: owner.userId, role: "owner", joinedAt: Date.now() }).run();
  for (const [a, role] of others) {
    if (a.kind !== "user") continue;
    db.insert(projectMembers).values({ projectId: id, userId: a.userId, role, joinedAt: Date.now() }).run();
  }
  return id;
}

export function makeTestApp(
  db: Db,
  extra?: (app: Hono) => void,
  opts?: { staticRoot?: string },
): { app: Hono; lines: string[] } {
  const lines: string[] = [];
  // Tests must not depend on whether apps/web/dist happens to exist on disk (e.g. from a local
  // `pnpm --filter @storylane/web build`): default to a path that never exists so createApp's
  // static-serving block stays off unless a test opts in via `opts.staticRoot`.
  const staticRoot = opts?.staticRoot ?? join(tmpdir(), `storylane-no-static-${crypto.randomUUID()}`);
  const app = createApp({
    config: loadConfig({}),
    log: createLogger((l) => lines.push(l)),
    health: () => true,
    db,
    testActorHeader: true,
    staticRoot,
  });
  extra?.(app);
  return { app, lines };
}
