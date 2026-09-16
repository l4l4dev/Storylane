import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { BUILT_IN_POINT_SCALES, DEFAULT_POINT_SCALE, projectMembers, projects } from "../db/schema";
import { formatDateOnly, isoWeekday, MS_PER_DAY } from "@storylane/core";
import { assertNoOpenTransaction, type Actor, type ProjectTx } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { bootstrapScope, recordActivity } from "./activity";

/**
 * PROVISIONAL (Task 7 owns the settings service): projects.week_start_day's own default. Task 7
 * decides what a new project actually starts on; this pair exists only because the
 * projects_start_date_matches_week_start trigger refuses an insert without a valid start_date.
 */
const DEFAULT_WEEK_START_DAY = 1;

/**
 * PROVISIONAL (Task 7 owns the settings service): the most recent `weekStartDay` on or before
 * `now` in UTC, as the YYYY-MM-DD the trigger expects. "The most recent UTC Monday" is an
 * invented default — Task 7 replaces it with the one its Step 7 specifies.
 */
function mostRecentWeekStart(now: number, weekStartDay: number): string {
  const back = (isoWeekday(now) - weekStartDay + 7) % 7;
  return formatDateOnly(now - back * MS_PER_DAY);
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  archivedAt: number | null;
  role: MemberRole;
  /**
   * PROVISIONAL (Task 7 owns the settings service): the comma-separated ascending point values
   * (core-model §2.2). Task 7 adds the rest of the settings fields and `point_scale_is_custom`.
   */
  pointScale: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  archivedAt: number | null;
  role: MemberRole;
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  /** PROVISIONAL (Task 7 owns the settings service): see ProjectDetail.pointScale. */
  pointScale?: string;
}

/**
 * Not project-scoped: there is no project to authorize against yet, so this opens its own
 * immediate transaction and writes its activity rows through bootstrapScope. Any signed-in
 * user may create a project (`"self"` rule in the route manifest).
 *
 * Same rule as revokeUserSessions/changePassword: bun:sqlite has no savepoints here, so call
 * this at the top level, never inside a withProject callback.
 */
export function createProject(db: Db, actor: Actor, input: { name: string }): ProjectDetail {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  if (input.name.trim().length === 0) throw new HttpError(400, "name_required");
  assertNoOpenTransaction("createProject");
  const now = Date.now();
  const id = newId();
  return db.transaction(
    (tx) => {
      tx
        .insert(projects)
        .values({
          id,
          name: input.name.trim(),
          startDate: mostRecentWeekStart(now, DEFAULT_WEEK_START_DAY),
          createdBy: actor.userId,
          createdAt: now,
        })
        .run();
      tx.insert(projectMembers).values({ projectId: id, userId: actor.userId, role: "owner", joinedAt: now }).run();
      recordActivity(bootstrapScope(tx, id, actor), {
        // PROVISIONAL (Task 7 owns the settings service): placeholder activity copy — Tracker's
        // own wording for these actions is not specified in the plan.
        kind: "project_update_activity",
        message: `created ${input.name.trim()}`,
        highlight: "created",
        changes: [{ kind: "project", id, change_type: "create", new_values: { name: input.name.trim() } }],
        primaryResources: [{ kind: "project", id }],
      });
      return {
        id,
        name: input.name.trim(),
        description: null,
        archivedAt: null,
        role: "owner" as MemberRole,
        pointScale: DEFAULT_POINT_SCALE,
      };
    },
    { behavior: "immediate" },
  );
}

/**
 * Archived projects come last (spec/ux-principles.md principle 9 — never interleaved); within
 * each group, alphabetical by name reads better than creation order, case-insensitively so
 * "bravo" and "Alpha" don't split by case; createdAt only breaks a tie between equal names.
 */
export function listProjects(db: Db, actor: Actor): ProjectSummary[] {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return db
    .select({
      id: projects.id,
      name: projects.name,
      archivedAt: projects.archivedAt,
      role: projectMembers.role,
    })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)))
    .orderBy(
      sql`(${projects.archivedAt} is not null)`,
      sql`${projects.name} collate nocase`,
      projects.createdAt,
    )
    .all() as ProjectSummary[];
}

export function readProject(tx: ProjectTx): ProjectDetail {
  const row = tx.tx
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      archivedAt: projects.archivedAt,
      pointScale: projects.pointScale,
    })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return { ...row, role: tx.role };
}

/**
 * PROVISIONAL (Task 7 owns the settings service): Tracker stores the scale as a comma-separated
 * ascending list, so the three built-ins are just three such lists and "custom" is any other one.
 */
function assertValidPointScale(pointScale: string): void {
  if ((BUILT_IN_POINT_SCALES as readonly string[]).includes(pointScale)) return;
  const parts = pointScale.split(",");
  if (parts.length === 0 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) throw new HttpError(400, "point_scale_invalid");
  const values = parts.map((p) => Number(p));
  if (values.some((n) => !Number.isFinite(n) || n < 0)) throw new HttpError(400, "point_scale_invalid");
  if (values.some((n, i) => i > 0 && n <= values[i - 1]!)) throw new HttpError(400, "point_scale_invalid");
}

export function updateProject(tx: ProjectTx, patch: ProjectPatch): ProjectDetail {
  const set: Record<string, unknown> = {};
  // An activity payload carries column names (ActivityChange in services/activity.ts), so it
  // cannot reuse `set` — those are Drizzle's camelCase property names.
  const newValues: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) throw new HttpError(400, "name_required");
    set.name = name;
    newValues.name = name;
  }
  if (patch.description !== undefined) {
    set.description = patch.description;
    newValues.description = patch.description;
  }
  if (patch.pointScale !== undefined) {
    assertValidPointScale(patch.pointScale);
    set.pointScale = patch.pointScale;
    newValues.point_scale = patch.pointScale;
  }
  if (Object.keys(set).length > 0) {
    tx.tx.update(projects).set(set as never).where(eq(projects.id, tx.projectId)).run();
    recordActivity(tx, {
      // PROVISIONAL (Task 7 owns the settings service): Tracker's own wording for a project
      // update is not in the plan; these strings are placeholders it will replace.
      kind: "project_update_activity",
      message: "updated the project",
      highlight: "updated",
      changes: [{ kind: "project", id: tx.projectId, change_type: "update", new_values: newValues }],
      primaryResources: [{ kind: "project", id: tx.projectId }],
    });
  }
  return readProject(tx);
}

export function setArchived(tx: ProjectTx, archived: boolean): ProjectDetail {
  const archivedAt = archived ? Date.now() : null;
  tx.tx.update(projects).set({ archivedAt }).where(eq(projects.id, tx.projectId)).run();
  recordActivity(tx, {
    // PROVISIONAL (Task 7 owns the settings service): placeholder copy, as above.
    kind: "project_update_activity",
    message: archived ? "archived the project" : "unarchived the project",
    highlight: archived ? "archived" : "unarchived",
    changes: [{ kind: "project", id: tx.projectId, change_type: "update", new_values: { archived_at: archivedAt } }],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
  return readProject(tx);
}

export function deleteProject(tx: ProjectTx): void {
  // Members and activity rows all cascade from projects.id.
  tx.tx.delete(projects).where(eq(projects.id, tx.projectId)).run();
}
