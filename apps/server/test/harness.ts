import { and, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createLogger } from "../src/log";
import { openDatabase, type Db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import type { AttachmentStore } from "../src/attachments/store";
import {
  blockers,
  comments,
  epics,
  fileAttachments,
  labels,
  projectMembers,
  projects,
  reviews,
  reviewTypes,
  stories,
  tasks,
  users,
  type ReviewStatus,
  type StoryList,
  type StoryState,
  type StoryType,
} from "../src/db/schema";
import { newId } from "../src/id";
import { hashPassword } from "../src/auth/password";
import { actorFromRequest } from "../src/auth/actor";
import { CREATE_SCOPED_ITEMS } from "./scoped-items";
import type { Actor } from "../src/db/tx";
import { EventBus } from "../src/events/bus";
import type { RateLimiter } from "../src/auth/rate-limit";

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
  db.insert(projects)
    .values({ id, name: "P", startDate: "2026-09-14", createdBy: owner.userId, createdAt: Date.now() })
    .run();
  db.insert(projectMembers).values({ projectId: id, userId: owner.userId, role: "owner", joinedAt: Date.now() }).run();
  for (const [a, role] of others) {
    if (a.kind !== "user") continue;
    db.insert(projectMembers).values({ projectId: id, userId: a.userId, role, joinedAt: Date.now() }).run();
  }
  return id;
}

/** Seeds one story with the next free number, at the end of its list. */
export function seedStory(
  db: Db,
  projectId: string,
  input: {
    name?: string;
    list?: StoryList;
    currentState?: StoryState;
    storyType?: StoryType;
    estimate?: number | null;
    position?: number;
  } = {},
): string {
  const id = newId();
  const list = input.list ?? "icebox";
  const next = db
    .select({ n: sql<number>`coalesce(max(${stories.number}), 0) + 1` })
    .from(stories)
    .where(eq(stories.projectId, projectId))
    .get();
  const tail = db
    .select({ p: sql<number>`coalesce(max(${stories.position}), 0) + 1024` })
    .from(stories)
    .where(and(eq(stories.projectId, projectId), eq(stories.list, list)))
    .get();
  db.insert(stories)
    .values({
      id,
      projectId,
      number: next?.n ?? 1,
      name: input.name ?? "story",
      storyType: input.storyType ?? "feature",
      currentState: input.currentState ?? (list === "icebox" ? "unscheduled" : "unstarted"),
      estimate: input.estimate ?? null,
      list,
      position: input.position ?? tail?.p ?? 1024,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

export function seedLabel(db: Db, projectId: string, name: string): string {
  const id = newId();
  db.insert(labels).values({ id, projectId, name, createdAt: Date.now(), updatedAt: Date.now() }).run();
  return id;
}

/** Seeds an epic backed by its own fresh label (`${name} epic label`), never `name` itself. */
export function seedEpic(db: Db, projectId: string, name: string): string {
  const labelId = seedLabel(db, projectId, `${name} epic label`);
  const next = db
    .select({ n: sql<number>`coalesce(max(${epics.position}), -1) + 1` })
    .from(epics)
    .where(eq(epics.projectId, projectId))
    .get();
  const id = newId();
  db.insert(epics)
    .values({
      id,
      projectId,
      name,
      labelId,
      position: next?.n ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

export function seedTask(db: Db, projectId: string, storyId: string, description: string): string {
  const next = db
    .select({ n: sql<number>`coalesce(max(${tasks.position}), -1) + 1` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.storyId, storyId)))
    .get();
  const id = newId();
  db.insert(tasks)
    .values({
      id,
      projectId,
      storyId,
      description,
      complete: false,
      position: next?.n ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

/** Seeds a blocker row directly, bypassing #n resolution — free text is enough for the matrix. */
export function seedBlocker(db: Db, projectId: string, storyId: string, author: Actor, description = "seeded blocker"): string {
  if (author.kind !== "user") throw new Error("author must be a user");
  const id = newId();
  db.insert(blockers)
    .values({
      id,
      projectId,
      storyId,
      blockingStoryId: null,
      description,
      resolved: false,
      personId: author.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

/** Seeds a comment row directly, bypassing the role checks, so a viewer can own one for the matrix. */
/** Seeds a review type row directly (not one of the four built-ins); seedProject does not seed those. */
export function seedReviewType(db: Db, projectId: string, name = "Matrix review type seed"): string {
  const next = db
    .select({ n: sql<number>`coalesce(max(${reviewTypes.position}), -1) + 1` })
    .from(reviewTypes)
    .where(eq(reviewTypes.projectId, projectId))
    .get();
  const id = newId();
  db.insert(reviewTypes)
    .values({ id, projectId, name, hidden: false, position: next?.n ?? 0, createdAt: Date.now(), updatedAt: Date.now() })
    .run();
  return id;
}

export function seedReview(
  db: Db,
  projectId: string,
  storyId: string,
  reviewTypeId: string,
  input: { reviewerId?: string | null; status?: ReviewStatus } = {},
): string {
  const id = newId();
  db.insert(reviews)
    .values({
      id,
      projectId,
      storyId,
      reviewTypeId,
      reviewerId: input.reviewerId ?? null,
      status: input.status ?? "unstarted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

export function seedComment(db: Db, projectId: string, storyId: string, author: Actor, text = "seeded comment"): string {
  if (author.kind !== "user") throw new Error("author must be a user");
  const id = newId();
  db.insert(comments)
    .values({ id, projectId, storyId, text, personId: author.userId, createdAt: Date.now(), updatedAt: Date.now() })
    .run();
  return id;
}

/** Seeds an attachment row plus its bytes, written through the store the app under test reads from. */
export function seedAttachment(
  db: Db,
  store: AttachmentStore,
  projectId: string,
  commentId: string,
  uploader: Actor,
  input: { filename?: string; contentType?: string; bytes?: string } = {},
): string {
  if (uploader.kind !== "user") throw new Error("uploader must be a user");
  const id = newId();
  const bytes = new TextEncoder().encode(input.bytes ?? "seeded bytes");
  const storagePath = store.put(projectId, id, bytes.buffer);
  db.insert(fileAttachments)
    .values({
      id,
      projectId,
      commentId,
      filename: input.filename ?? "seeded.txt",
      contentType: input.contentType ?? "text/plain",
      size: bytes.byteLength,
      storagePath,
      uploaderId: uploader.userId,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export function makeTestApp(
  db: Db,
  extra?: (app: Hono) => void,
  opts?: {
    staticRoot?: string;
    bus?: EventBus;
    heartbeatMs?: number;
    maxStreamsPerUser?: number;
    inviteLimiter?: RateLimiter;
    resetLimiter?: RateLimiter;
    adminLimiter?: RateLimiter;
    /** Attachment bytes land here. Defaults to a never-created temp path, so no test writes to /data. */
    dataDir?: string;
  },
): { app: Hono; lines: string[]; bus: EventBus } {
  const lines: string[] = [];
  const bus = opts?.bus ?? new EventBus();
  // Tests must not depend on whether apps/web/dist happens to exist on disk (e.g. from a local
  // `pnpm --filter @storylane/web build`): default to a path that never exists so createApp's
  // static-serving block stays off unless a test opts in via `opts.staticRoot`.
  const staticRoot = opts?.staticRoot ?? join(tmpdir(), `storylane-no-static-${crypto.randomUUID()}`);
  const app = createApp({
    config: {
      ...loadConfig({}),
      dataDir: opts?.dataDir ?? join(tmpdir(), `storylane-test-data-${crypto.randomUUID()}`),
    },
    log: createLogger((l) => lines.push(l)),
    health: () => true,
    db,
    bus,
    ...(opts?.heartbeatMs === undefined ? {} : { heartbeatMs: opts.heartbeatMs }),
    ...(opts?.maxStreamsPerUser === undefined ? {} : { maxStreamsPerUser: opts.maxStreamsPerUser }),
    ...(opts?.inviteLimiter === undefined ? {} : { inviteLimiter: opts.inviteLimiter }),
    ...(opts?.resetLimiter === undefined ? {} : { resetLimiter: opts.resetLimiter }),
    ...(opts?.adminLimiter === undefined ? {} : { adminLimiter: opts.adminLimiter }),
    // Both actor sources: the matrix tests address routes by header, the auth-route tests by a
    // real session cookie.
    actorOf: (c) => {
      const raw = c.req.header("x-test-actor");
      if (raw) {
        const parsed = JSON.parse(raw) as Actor;
        if (parsed.kind === "user") return { kind: "user", userId: parsed.userId, isAdmin: parsed.isAdmin === true };
      }
      return actorFromRequest(db)(c);
    },
    testActorHeader: true,
    staticRoot,
  });
  extra?.(app);
  return { app, lines, bus };
}

/** Cheap argon2id parameters: these tests assert behaviour, not cost. */
const TEST_ARGON2 = { algorithm: "argon2id", memoryCost: 1024, timeCost: 1 } as const;

export async function seedUserWithPassword(
  db: Db,
  email: string,
  password: string,
  opts: { isAdmin?: boolean } = {},
): Promise<Actor> {
  const actor = seedUser(db, email, opts.isAdmin ?? false);
  if (actor.kind !== "user") throw new Error("unreachable");
  db.update(users)
    .set({ passwordHash: await hashPassword(password, TEST_ARGON2) })
    .where(eq(users.id, actor.userId))
    .run();
  return actor;
}

/** Logs in through the real route and returns the `name=value` cookie pair for later requests. */
export async function loginAs(app: Hono, email: string, password: string, origin = "http://127.0.0.1"): Promise<string> {
  const res = await app.request(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`loginAs failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("loginAs: no session cookie in the response");
  return cookie;
}
