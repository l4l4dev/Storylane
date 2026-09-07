import { and, eq, sql } from "drizzle-orm";
import templates from "../../../../spec/fixtures/state-templates.json";
import { projectStates, stories, type StateCategory } from "../db/schema";
import { loadInProject, reorder, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity, type ActivityScope } from "./activity";

export interface StateRow {
  id: string;
  name: string;
  category: StateCategory;
  actionLabel: string | null;
  position: number;
}

export type ProjectTemplate = "classic" | "minimal";

const COLUMNS = {
  id: projectStates.id,
  name: projectStates.name,
  category: projectStates.category,
  actionLabel: projectStates.actionLabel,
  position: projectStates.position,
};

function readAll(scope: ActivityScope): StateRow[] {
  return scope.tx
    .select(COLUMNS)
    .from(projectStates)
    .where(eq(projectStates.projectId, scope.projectId))
    .orderBy(projectStates.position)
    .all();
}

export function listStates(tx: ProjectTx): StateRow[] {
  return readAll(tx);
}

/** Project creation runs before the creator is a member, so this takes an ActivityScope. */
export function seedTemplateStates(scope: ActivityScope, template: ProjectTemplate): StateRow[] {
  const now = Date.now();
  for (const state of templates[template].states) {
    const id = newId();
    scope.tx
      .insert(projectStates)
      .values({
        id,
        projectId: scope.projectId,
        name: state.name,
        category: state.category as StateCategory,
        actionLabel: state.actionLabel,
        position: state.position,
        createdAt: now,
      })
      .run();
    recordActivity(scope, { action: "state.created", payload: { name: state.name, category: state.category } });
  }
  return readAll(scope);
}

export function createState(
  tx: ProjectTx,
  input: { name: string; category: StateCategory; actionLabel?: string | null },
): StateRow {
  const next = tx.tx
    .select({ p: sql<number>`coalesce(max(${projectStates.position}), -1) + 1` })
    .from(projectStates)
    .where(eq(projectStates.projectId, tx.projectId))
    .get();
  const id = newId();
  tx.tx
    .insert(projectStates)
    .values({
      id,
      projectId: tx.projectId,
      name: input.name,
      category: input.category,
      actionLabel: input.actionLabel ?? null,
      position: next?.p ?? 0,
      createdAt: Date.now(),
    })
    .run();
  recordActivity(tx, { action: "state.created", payload: { name: input.name, category: input.category } });
  return readAll(tx).find((s) => s.id === id)!;
}

export function updateState(
  tx: ProjectTx,
  stateId: string,
  patch: { name?: string; actionLabel?: string | null; category?: StateCategory },
): StateRow {
  const current = loadInProject(tx, projectStates, stateId);
  // The DB trigger is the backstop; refusing here gives the client a code it can show.
  if (patch.category !== undefined && patch.category !== current.category) {
    throw new HttpError(409, "state_category_immutable");
  }
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.actionLabel !== undefined) set.actionLabel = patch.actionLabel;
  if (Object.keys(set).length > 0) {
    tx.tx.update(projectStates).set(set as never).where(eq(projectStates.id, stateId)).run();
    recordActivity(tx, { action: "state.updated", payload: { stateId, ...set } });
  }
  return readAll(tx).find((s) => s.id === stateId)!;
}

export function reorderStates(tx: ProjectTx, orderedIds: string[]): StateRow[] {
  reorder(tx, projectStates, eq(projectStates.projectId, tx.projectId), orderedIds);
  recordActivity(tx, { action: "state.reordered", payload: { orderedIds } });
  return readAll(tx);
}

/**
 * A project must always be able to receive and complete work, so at least one `unstarted`
 * and one `done` state survive every delete (spec/data-model.md "Integrity rules").
 */
export function deleteState(tx: ProjectTx, stateId: string): void {
  const state = loadInProject(tx, projectStates, stateId);
  const all = readAll(tx);
  if (
    (state.category === "unstarted" || state.category === "done") &&
    all.filter((s) => s.category === state.category).length === 1
  ) {
    throw new HttpError(409, "state_last_of_category");
  }
  const inUse = tx.tx
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.stateId, stateId)))
    .limit(1)
    .get();
  if (inUse) throw new HttpError(409, "state_in_use");
  tx.tx.delete(projectStates).where(eq(projectStates.id, stateId)).run();
  reorder(
    tx,
    projectStates,
    eq(projectStates.projectId, tx.projectId),
    all.filter((s) => s.id !== stateId).map((s) => s.id),
  );
  recordActivity(tx, { action: "state.deleted", payload: { stateId, name: state.name } });
}
