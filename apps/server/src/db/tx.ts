import { and, eq, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import { projectMembers, projects, users } from "./schema";
import { HttpError } from "../http-error";
import { noteAuthorized } from "../authz/context";
import { expected, isWrite, type Action, type MemberRole, type Role } from "../authz/permissions";

export type Actor = { kind: "anonymous" } | { kind: "user"; userId: string; isAdmin: boolean };
export type UserActor = Extract<Actor, { kind: "user" }>;

/** Drizzle's synchronous transaction handle for bun-sqlite. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * bun:sqlite transactions are synchronous: an async callback would commit at its
 * first await, so a Promise-returning callback is rejected at compile time.
 * `eslint-rules/no-await-in-transaction.js` catches the same mistake in JS.
 */
export type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

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
  #tx: Tx;
  #live = true;

  private constructor(
    tx: Tx,
    readonly projectId: string,
    readonly role: MemberRole,
    readonly actor: Actor,
  ) {
    this.#tx = tx;
  }

  /** The drizzle transaction handle. Throws once the transaction it belongs to has returned. */
  get tx(): Tx {
    if (!this.#live) throw new Error("ProjectTx used outside its transaction");
    return this.#tx;
  }

  /** @internal — withProject/withTwoProjects call this once their db.transaction() call returns. */
  _invalidate(token: typeof CREATE_TOKEN): void {
    if (token !== CREATE_TOKEN) throw new Error("ProjectTx is invalidated by withProject/withTwoProjects only");
    this.#live = false;
  }

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

/**
 * A synchronous callback must never return something that looks like a Promise: nothing here
 * awaits the result, so a thenable would only ever run its `.then()` after this function has
 * already returned (and the transaction has committed) — if some caller happened to await it.
 * `NotPromise` blocks this at compile time for ordinary async functions; this catches the rest
 * (a hand-built thenable, or a widened function type `tsc` cannot see through) at runtime.
 */
function rejectThenable<T>(result: T): T {
  if ((typeof result === "object" && result !== null) || typeof result === "function") {
    const then = (result as { then?: unknown }).then;
    if (typeof then === "function") throw new Error("withProject callback must be synchronous");
  }
  return result;
}

/** Precedence is fixed by spec/permissions.md: 401 (anon) → 401 (disabled) → 404 → 409 → 403. */
function authorizeIn(tx: Tx, actor: Actor, projectId: string, action: Action): ProjectTx {
  // Before any lookup: an anonymous caller must not learn whether the project exists.
  if (actor.kind === "anonymous") throw new HttpError(401, "unauthenticated");
  // Independent of projectId, so a disabled user gets 401 even for an unknown project.
  if (isUserDisabled(tx, actor)) throw new HttpError(401, "unauthenticated");
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
  noteAuthorized(projectId);
  return ProjectTx._create(CREATE_TOKEN, tx, projectId, role, actor);
}

function isUserDisabled(tx: Tx, actor: UserActor): boolean {
  const user = tx.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, actor.userId)).get();
  return !user || user.disabledAt !== null;
}

function resolveRole(tx: Tx, actor: UserActor, projectId: string): { role: Role; archived: boolean } {
  const project = tx
    .select({ id: projects.id, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new HttpError(404, "not_found");
  const m = tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.userId)))
    .get();
  return { role: (m?.role ?? "non-member") as Role, archived: project.archivedAt !== null };
}

/**
 * bun:sqlite has no savepoints here, so an inner transaction would commit the outer one.
 * One withProject per request: services take the ProjectTx they are given and never open
 * their own.
 */
let transactionOpen = false;

/**
 * For code that must own its own top-level transaction (revokeUserSessions): bun:sqlite has no
 * savepoints here, so opening one inside a withProject callback would commit the outer one.
 */
export function assertNoOpenTransaction(what: string): void {
  if (transactionOpen) throw new Error(`${what} cannot run inside withProject`);
}

function openTransaction<T>(run: () => T): T {
  if (transactionOpen) throw new Error("withProject cannot be nested");
  transactionOpen = true;
  try {
    return run();
  } finally {
    transactionOpen = false;
  }
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
  let ptx: ProjectTx | undefined;
  return openTransaction(() => {
    try {
      return db.transaction((tx) => {
        ptx = authorizeIn(tx, actor, projectId, action);
        return rejectThenable(fn(ptx));
      }, { behavior }) as T;
    } finally {
      // The transaction has returned (committed or rolled back) by the time finally runs;
      // ptx must not be usable by a closure the caller kept from inside fn.
      ptx?._invalidate(CREATE_TOKEN);
    }
  });
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
  let fromTx: ProjectTx | undefined;
  let toTx: ProjectTx | undefined;
  return openTransaction(() => {
    try {
      return db.transaction((tx) => {
        fromTx = authorizeIn(tx, actor, fromId, action);
        toTx = authorizeIn(tx, actor, toId, action);
        return rejectThenable(fn(fromTx, toTx));
      }, { behavior: "immediate" }) as T;
    } finally {
      fromTx?._invalidate(CREATE_TOKEN);
      toTx?._invalidate(CREATE_TOKEN);
    }
  });
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
  // An id the caller could not have gotten from this project's own list is a client error
  // shaped like "not found", not a shape problem with the request — distinct from a
  // wrong-count/duplicate list, which is the request being malformed regardless of which ids
  // it named.
  if (orderedIds.some((id) => !have.has(id))) {
    throw new HttpError(404, "not_found");
  }
  const want = new Set(orderedIds);
  if (want.size !== orderedIds.length || want.size !== have.size) {
    throw new HttpError(400, "ordered_ids_invalid", "orderedIds must list every row in scope exactly once");
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
