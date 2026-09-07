import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { projectMembers, projects, type PointScale } from "../db/schema";
import type { Actor, ProjectTx } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { bootstrapScope, recordActivity } from "./activity";
import { seedTemplateStates, type ProjectTemplate } from "./states";

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  archivedAt: number | null;
  role: MemberRole;
  pointScale: PointScale;
  customPoints: number[] | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  archivedAt: number | null;
  role: MemberRole;
}

export type { ProjectTemplate };

/**
 * Not project-scoped: there is no project to authorize against yet, so this opens its own
 * immediate transaction and writes its activity rows through bootstrapScope. Any signed-in
 * user may create a project (`"self"` rule in the route manifest).
 */
export function createProject(
  db: Db,
  actor: Actor,
  input: { name: string; template?: ProjectTemplate },
): ProjectDetail {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  if (input.name.trim().length === 0) throw new HttpError(400, "name_required");
  const now = Date.now();
  const id = newId();
  return db.transaction(
    (tx) => {
      tx.insert(projects).values({ id, name: input.name.trim(), createdBy: actor.userId, createdAt: now }).run();
      tx.insert(projectMembers).values({ projectId: id, userId: actor.userId, role: "owner", joinedAt: now }).run();
      const scope = bootstrapScope(tx, id, actor);
      recordActivity(scope, { action: "project.created", payload: { name: input.name.trim() } });
      seedTemplateStates(scope, input.template ?? "classic");
      return {
        id,
        name: input.name.trim(),
        description: null,
        archivedAt: null,
        role: "owner" as MemberRole,
        pointScale: "fibonacci" as PointScale,
        customPoints: null,
      };
    },
    { behavior: "immediate" },
  );
}

/** Archived projects come last (spec/ux-principles.md principle 9 — never interleaved). */
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
    .orderBy(projects.archivedAt, desc(projects.createdAt))
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
      customPoints: projects.customPoints,
    })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return {
    ...row,
    customPoints: row.customPoints === null ? null : (JSON.parse(row.customPoints) as number[]),
    role: tx.role,
  };
}

/**
 * `custom` needs an explicit ordered scale to offer in the point picker; every other scale is
 * hardcoded client-side (spec/data-model.md "point_scale"), so custom_points must be null there.
 */
function assertValidPointScale(pointScale: PointScale, customPoints: number[] | null): void {
  if (pointScale === "custom") {
    if (customPoints === null || customPoints.length === 0) throw new HttpError(400, "custom_points_required");
    if (customPoints.some((n) => !Number.isInteger(n) || n < 0)) throw new HttpError(400, "custom_points_invalid");
    const sorted = [...customPoints].sort((a, b) => a - b);
    if (!customPoints.every((n, i) => n === sorted[i])) throw new HttpError(400, "custom_points_invalid");
  } else if (customPoints !== null) {
    throw new HttpError(400, "custom_points_must_be_null");
  }
}

export function updateProject(
  tx: ProjectTx,
  patch: { name?: string; description?: string | null; pointScale?: PointScale; customPoints?: number[] | null },
): ProjectDetail {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    if (patch.name.trim().length === 0) throw new HttpError(400, "name_required");
    set.name = patch.name.trim();
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.pointScale !== undefined || patch.customPoints !== undefined) {
    const current = readProject(tx);
    const finalScale = patch.pointScale ?? current.pointScale;
    const finalCustom = patch.customPoints !== undefined ? patch.customPoints : current.customPoints;
    assertValidPointScale(finalScale, finalCustom);
    if (patch.pointScale !== undefined) set.pointScale = patch.pointScale;
    if (patch.customPoints !== undefined) {
      set.customPoints = patch.customPoints === null ? null : JSON.stringify(patch.customPoints);
    }
  }
  if (Object.keys(set).length > 0) {
    tx.tx.update(projects).set(set as never).where(eq(projects.id, tx.projectId)).run();
    recordActivity(tx, { action: "project.updated", payload: set });
  }
  return readProject(tx);
}

export function setArchived(tx: ProjectTx, archived: boolean): ProjectDetail {
  tx.tx
    .update(projects)
    .set({ archivedAt: archived ? Date.now() : null })
    .where(eq(projects.id, tx.projectId))
    .run();
  recordActivity(tx, { action: archived ? "project.archived" : "project.unarchived", payload: null });
  return readProject(tx);
}

export function deleteProject(tx: ProjectTx): void {
  // Members, states, stories and activity rows all cascade from projects.id.
  tx.tx.delete(projects).where(eq(projects.id, tx.projectId)).run();
}
