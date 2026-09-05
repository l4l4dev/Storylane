import { and, eq, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import { projectMembers, projects, users } from "./schema";
import { HttpError } from "../http-error";
import { noteAuthorized } from "../authz/context";
import { expected, isWrite, type Action, type MemberRole, type Role } from "../authz/permissions";

export type Actor = { kind: "anonymous" } | { kind: "user"; userId: string; isAdmin: boolean };
type UserActor = Extract<Actor, { kind: "user" }>;

/** Drizzle's synchronous transaction handle for bun-sqlite. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * bun:sqlite transactions are synchronous: an async callback would commit at its
 * first await, so a Promise-returning callback is rejected at compile time.
 * `eslint-rules/no-await-in-transaction.js` catches the same mistake in JS.
 */
type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

type AnyColumn = SQLiteTable["_"]["columns"][string];

export interface ScopedTable extends SQLiteTable {
  id: AnyColumn;
  projectId: AnyColumn;
}
export interface OrderedTable extends ScopedTable {
  position: AnyColumn;
}

/** Not exported: only this module can produce a value of this type. */
const CREATE_TOKEN = Symbol("ProjectTx");

/** The only handle through which project data may be read or written. */
export class ProjectTx {
  private constructor(
    readonly tx: Tx,
    readonly projectId: string,
    readonly role: MemberRole,
    readonly actor: Actor,
  ) {}
  /** @internal — the token makes withProject/withTwoProjects the only possible callers. */
  static _create(
    token: typeof CREATE_TOKEN,
    tx: Tx,
    projectId: string,
    role: MemberRole,
    actor: Actor,
  ): ProjectTx {
    if (token !== CREATE_TOKEN) throw new Error("ProjectTx is created by withProject/withTwoProjects only");
    return new ProjectTx(tx, projectId, role, actor);
  }
}

function resolveRole(tx: Tx, actor: UserActor, projectId: string): { role: Role; archived: boolean } {
  const project = tx
    .select({ id: projects.id, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new HttpError(404, "not_found");
  const user = tx
    .select({ disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, actor.userId))
    .get();
  if (!user || user.disabledAt !== null) throw new HttpError(401, "unauthenticated");
  const m = tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.userId)))
    .get();
  return { role: (m?.role ?? "non-member") as Role, archived: project.archivedAt !== null };
}

/** Precedence is fixed by spec/permissions.md: 401 → 404 → 409 → 403. */
function authorizeIn(tx: Tx, actor: Actor, projectId: string, action: Action): ProjectTx {
  // Before the project lookup: an anonymous caller must not learn whether the project exists.
  if (actor.kind === "anonymous") throw new HttpError(401, "unauthenticated");
  const { role, archived } = resolveRole(tx, actor, projectId);
  // Deliberate defense in depth: resolveRole cannot return these, but a ProjectTx
  // must carry a membership role even if that ever changes.
  if (role === "anonymous" || role === "non-member") throw new HttpError(404, "not_found");
  if (archived && isWrite(action) && action !== "project:archive" && action !== "project:delete") {
    throw new HttpError(409, "project_archived");
  }
  const code = expected(action, role);
  if (code === 403) throw new HttpError(403, "forbidden");
  if (code !== 200) throw new Error(`unexpected permission code ${code} for ${action} as ${role}`);
  noteAuthorized();
  return ProjectTx._create(CREATE_TOKEN, tx, projectId, role, actor);
}

/**
 * Opens a top-level transaction; do not nest withProject calls
 * (no savepoint support yet — the inner call would commit the outer one).
 */
export function withProject<T>(
  db: Db,
  actor: Actor,
  projectId: string,
  action: Action,
  fn: (tx: ProjectTx) => NotPromise<T>,
): T {
  const behavior = isWrite(action) ? "immediate" : "deferred";
  return db.transaction((tx) => fn(authorizeIn(tx, actor, projectId, action)), { behavior }) as T;
}

/** Same nesting rule as withProject: this is the top-level transaction. */
export function withTwoProjects<T>(
  db: Db,
  actor: Actor,
  fromId: string,
  toId: string,
  action: Action,
  fn: (from: ProjectTx, to: ProjectTx) => NotPromise<T>,
): T {
  return db.transaction(
    (tx) => fn(authorizeIn(tx, actor, fromId, action), authorizeIn(tx, actor, toId, action)),
    { behavior: "immediate" },
  ) as T;
}

export function loadInProject<TTable extends ScopedTable>(
  tx: ProjectTx,
  table: TTable,
  id: string,
): TTable["$inferSelect"] {
  const row = tx.tx
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.projectId, tx.projectId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return row as TTable["$inferSelect"];
}

/**
 * Dense 0..n-1 renumbering in two passes because SQLite has no deferrable UNIQUE.
 * `scope` must select exactly the rows covered by the table's (project_id, position)
 * UNIQUE constraint; a narrower scope collides with the rows it left out.
 */
export function reorder(tx: ProjectTx, table: OrderedTable, scope: SQL, orderedIds: string[]): void {
  const current = tx.tx
    .select({ id: table.id })
    .from(table)
    .where(and(scope, eq(table.projectId, tx.projectId)))
    .all() as { id: string }[];
  const have = new Set(current.map((r) => r.id));
  const want = new Set(orderedIds);
  if (have.size !== want.size || [...have].some((id) => !want.has(id))) {
    throw new Error("reorder: orderedIds is not a permutation of the scoped rows");
  }
  orderedIds.forEach((id, rank) => {
    tx.tx
      .update(table)
      .set({ position: -rank - 1 } as never)
      .where(and(eq(table.id, id), eq(table.projectId, tx.projectId)))
      .run();
  });
  orderedIds.forEach((id, rank) => {
    tx.tx
      .update(table)
      .set({ position: rank } as never)
      .where(and(eq(table.id, id), eq(table.projectId, tx.projectId)))
      .run();
  });
}
