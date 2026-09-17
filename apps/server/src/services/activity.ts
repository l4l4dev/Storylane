import { and, desc, eq, gt, sql } from "drizzle-orm";
import { activities, activityResources, projects } from "../db/schema";
import { newId } from "../id";
import { ProjectTx, type Actor, type Tx } from "../db/tx";

/** Tracker's activity names (core-model §5.1); the DB CHECK only enforces the `_activity` suffix. */
export const ACTIVITY_KINDS = [
  "story_create_activity", "story_update_activity", "story_delete_activity", "story_move_activity",
  "epic_create_activity", "epic_update_activity", "epic_delete_activity", "epic_move_activity",
  "comment_create_activity", "comment_update_activity", "comment_delete_activity",
  "task_create_activity", "task_update_activity", "task_delete_activity",
  "label_create_activity", "label_update_activity", "label_delete_activity",
  "blocker_create_activity", "blocker_update_activity", "blocker_delete_activity",
  "review_create_activity", "review_update_activity", "review_delete_activity",
  "review_type_create_activity", "review_type_update_activity",
  "follower_create_activity", "follower_delete_activity",
  "iteration_update_activity", "project_update_activity",
  "project_membership_create_activity", "project_membership_update_activity", "project_membership_delete_activity",
  // Tracker has no invitation resource; these two are Storylane-only, for the invite lifecycle.
  "project_invite_create_activity", "project_invite_delete_activity",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ChangeType = "create" | "update" | "delete";

export interface ActivityChange {
  kind: string;
  id?: string;
  /** Stories carry #n as well as the id. */
  number?: number;
  change_type: ChangeType;
  /** snake_case field names, changed fields only. */
  original_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
}

export interface ActivityResourceRef {
  kind: string;
  id: string;
}

export interface ActivityEntry {
  kind: ActivityKind;
  message: string;
  highlight: string;
  changes: ActivityChange[];
  primaryResources: ActivityResourceRef[];
  secondaryResources?: ActivityResourceRef[];
}

export interface RecordedActivity {
  id: string;
  projectVersion: number;
}

export interface ActivityRow {
  guid: string;
  project_version: number;
  kind: ActivityKind;
  message: string;
  highlight: string;
  changes: ActivityChange[];
  primary_resources: ActivityResourceRef[];
  secondary_resources: ActivityResourceRef[];
  performed_by_id: string | null;
  occurred_at: number;
}

/** Not exported: only this module can produce a value of this type. */
const CREATE_TOKEN = Symbol("BootstrapScope");

/**
 * Project creation and invite acceptance write activity before the actor is a member, so
 * withProject cannot authorize them; they pass this instead. Every other caller passes a
 * ProjectTx. Both shapes carry tx/projectId/actor, which is all this module needs.
 *
 * A private field (not just a private constructor) makes this nominal: a plain
 * `{ tx, projectId, actor }` literal no longer structurally satisfies BootstrapScope,
 * so bootstrapScope() stays the only way to produce one (same pattern as ProjectTx).
 */
export class BootstrapScope {
  #tx: Tx;

  private constructor(
    tx: Tx,
    readonly projectId: string,
    readonly actor: Actor,
  ) {
    this.#tx = tx;
  }

  get tx(): Tx {
    return this.#tx;
  }

  /** @internal — bootstrapScope() calls this; the token makes it the only possible caller. */
  static _create(token: typeof CREATE_TOKEN, tx: Tx, projectId: string, actor: Actor): BootstrapScope {
    if (token !== CREATE_TOKEN) throw new Error("BootstrapScope is created by bootstrapScope() only");
    return new BootstrapScope(tx, projectId, actor);
  }
}

export type ActivityScope = ProjectTx | BootstrapScope;

export function bootstrapScope(tx: Tx, projectId: string, actor: Actor): BootstrapScope {
  return BootstrapScope._create(CREATE_TOKEN, tx, projectId, actor);
}

const KNOWN = new Set<string>(ACTIVITY_KINDS);

/** Reads the counter the last recordActivity produced; the SSE event carries it. */
export function projectVersion(scope: ActivityScope): number {
  const row = scope.tx.select({ v: projects.version }).from(projects).where(eq(projects.id, scope.projectId)).get();
  return row?.v ?? 0;
}

/**
 * The only writer of `activities`. Runs inside the caller's transaction, never its own, and
 * bumps projects.version in the same statement pair so the row's project_version is the value
 * this action produced (core-model §5.3). The UNIQUE (project_id, project_version) index is what
 * makes that claim enforceable.
 */
export function recordActivity(scope: ActivityScope, entry: ActivityEntry): RecordedActivity {
  if (!KNOWN.has(entry.kind)) throw new Error(`unknown activity kind: ${entry.kind}`);
  scope.tx
    .update(projects)
    .set({ version: sql`${projects.version} + 1` })
    .where(eq(projects.id, scope.projectId))
    .run();
  const version = projectVersion(scope);
  const id = newId();
  scope.tx
    .insert(activities)
    .values({
      id,
      projectId: scope.projectId,
      projectVersion: version,
      kind: entry.kind,
      message: entry.message,
      highlight: entry.highlight,
      changes: JSON.stringify(entry.changes),
      primaryResources: JSON.stringify(entry.primaryResources),
      secondaryResources: entry.secondaryResources ? JSON.stringify(entry.secondaryResources) : null,
      performedById: scope.actor.kind === "user" ? scope.actor.userId : null,
      occurredAt: Date.now(),
    })
    .run();
  const rows = [
    ...entry.primaryResources.map((r) => ({ ...r, role: "primary" as const })),
    ...(entry.secondaryResources ?? []).map((r) => ({ ...r, role: "secondary" as const })),
  ];
  for (const r of rows) {
    scope.tx
      .insert(activityResources)
      .values({ activityId: id, projectId: scope.projectId, resourceKind: r.kind, resourceId: r.id, role: r.role })
      .onConflictDoNothing()
      .run();
  }
  return { id, projectVersion: version };
}

function toRow(projectId: string, row: typeof activities.$inferSelect): ActivityRow {
  return {
    guid: `${projectId}_${row.projectVersion}`,
    project_version: row.projectVersion,
    kind: row.kind as ActivityKind,
    message: row.message,
    highlight: row.highlight,
    changes: JSON.parse(row.changes) as ActivityChange[],
    primary_resources: JSON.parse(row.primaryResources) as ActivityResourceRef[],
    secondary_resources: row.secondaryResources ? (JSON.parse(row.secondaryResources) as ActivityResourceRef[]) : [],
    performed_by_id: row.performedById,
    occurred_at: row.occurredAt,
  };
}

/** Oldest first, so a client applying them in order reaches the same state the server is in. */
export function listActivity(
  tx: ProjectTx,
  opts: { sinceVersion?: number; limit?: number; offset?: number },
): ActivityRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where =
    opts.sinceVersion === undefined
      ? eq(activities.projectId, tx.projectId)
      : and(eq(activities.projectId, tx.projectId), gt(activities.projectVersion, opts.sinceVersion));
  return tx.tx
    .select()
    .from(activities)
    .where(where)
    .orderBy(activities.projectVersion)
    .limit(limit)
    .offset(opts.offset ?? 0)
    .all()
    .map((r) => toRow(tx.projectId, r));
}

/** Newest first: the story panel shows the most recent action at the top. */
export function storyActivity(tx: ProjectTx, storyId: string, opts: { limit?: number } = {}): ActivityRow[] {
  return tx.tx
    .select({ a: activities })
    .from(activities)
    .innerJoin(
      activityResources,
      and(eq(activityResources.activityId, activities.id), eq(activityResources.projectId, activities.projectId)),
    )
    .where(
      and(
        eq(activities.projectId, tx.projectId),
        eq(activityResources.resourceKind, "story"),
        eq(activityResources.resourceId, storyId),
      ),
    )
    .groupBy(activities.id)
    .orderBy(desc(activities.projectVersion))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
    .all()
    .map((r) => toRow(tx.projectId, r.a));
}
