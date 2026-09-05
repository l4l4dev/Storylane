import { and, eq, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import { projectMembers, projects } from "./schema";
import { HttpError } from "../http-error";
import { expected, isWrite, type Action, type MemberRole, type Role } from "../authz/permissions";

export type Actor = { kind: "anonymous" } | { kind: "user"; userId: string; isAdmin: boolean };

/** Drizzle's synchronous transaction handle for bun-sqlite. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type AnyColumn = SQLiteTable["_"]["columns"][string];

export interface ScopedTable extends SQLiteTable {
  id: AnyColumn;
  projectId: AnyColumn;
}
export interface OrderedTable extends ScopedTable {
  position: AnyColumn;
}

/** The only handle through which project data may be read or written. */
export class ProjectTx {
  private constructor(
    readonly tx: Tx,
    readonly projectId: string,
    readonly role: MemberRole,
    readonly actor: Actor,
  ) {}
  /** @internal — only withProject/withTwoProjects call this. */
  static _create(tx: Tx, projectId: string, role: MemberRole, actor: Actor): ProjectTx {
    return new ProjectTx(tx, projectId, role, actor);
  }
}

function resolveRole(tx: Tx, actor: Actor, projectId: string): { role: Role; archived: boolean } {
  const project = tx
    .select({ id: projects.id, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new HttpError(404, "not_found");
  if (actor.kind === "anonymous") throw new HttpError(401, "unauthenticated");
  const m = tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.userId)))
    .get();
  return { role: (m?.role ?? "non-member") as Role, archived: project.archivedAt !== null };
}

function authorizeIn(tx: Tx, actor: Actor, projectId: string, action: Action): ProjectTx {
  // Before the project lookup: an anonymous caller must not learn whether the project exists.
  if (actor.kind === "anonymous") throw new HttpError(401, "unauthenticated");
  const { role, archived } = resolveRole(tx, actor, projectId);
  const code = expected(action, role);
  if (code === 404) throw new HttpError(404, "not_found");
  if (code === 403) throw new HttpError(403, "forbidden");
  if (code === 401) throw new HttpError(401, "unauthenticated");
  if (archived && isWrite(action) && action !== "project:archive") throw new HttpError(409, "project_archived");
  // Independent of the fixture: a ProjectTx only ever carries a membership role.
  if (role === "anonymous" || role === "non-member") throw new HttpError(404, "not_found");
  return ProjectTx._create(tx, projectId, role, actor);
}

export function withProject<T>(
  db: Db,
  actor: Actor,
  projectId: string,
  action: Action,
  fn: (tx: ProjectTx) => T,
): T {
  const behavior = isWrite(action) ? "immediate" : "deferred";
  return db.transaction((tx) => fn(authorizeIn(tx, actor, projectId, action)), { behavior });
}

export function withTwoProjects<T>(
  db: Db,
  actor: Actor,
  fromId: string,
  toId: string,
  action: Action,
  fn: (from: ProjectTx, to: ProjectTx) => T,
): T {
  return db.transaction(
    (tx) => fn(authorizeIn(tx, actor, fromId, action), authorizeIn(tx, actor, toId, action)),
    { behavior: "immediate" },
  );
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

/** Dense 0..n-1 renumbering in two passes because SQLite has no deferrable UNIQUE. */
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
