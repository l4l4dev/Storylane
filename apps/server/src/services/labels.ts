import { and, eq, sql } from "drizzle-orm";
import { epics, labels, stories, storyLabels, STORY_STATES, type StoryState } from "../db/schema";
import { loadInProject, reorder, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity } from "./activity";

export interface LabelCounts {
  number_of_stories_by_state: Record<StoryState, number>;
  sum_of_story_estimates_by_state: Record<StoryState, number>;
  number_of_zero_point_stories_by_state: Record<StoryState, number>;
}

export interface LabelRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  counts: LabelCounts;
}

export interface EpicRow {
  id: string;
  name: string;
  description: string | null;
  label_id: string;
  position: number;
  past_done_stories_count: number;
  past_done_story_estimates: number;
  completed_at: number | null;
}

function emptyCounts(): LabelCounts {
  const zero = () => Object.fromEntries(STORY_STATES.map((s) => [s, 0])) as Record<StoryState, number>;
  return {
    number_of_stories_by_state: zero(),
    sum_of_story_estimates_by_state: zero(),
    number_of_zero_point_stories_by_state: zero(),
  };
}

/** One grouped query for every label in the project, not one per label (labels.ts brief). */
function countsByLabel(tx: ProjectTx): Map<string, LabelCounts> {
  const rows = tx.tx
    .select({
      labelId: storyLabels.labelId,
      state: stories.currentState,
      cnt: sql<number>`count(*)`,
      estSum: sql<number>`coalesce(sum(${stories.estimate}), 0)`,
      zeroCnt: sql<number>`sum(case when ${stories.estimate} = 0 then 1 else 0 end)`,
    })
    .from(storyLabels)
    .innerJoin(stories, and(eq(storyLabels.storyId, stories.id), eq(storyLabels.projectId, stories.projectId)))
    .where(eq(storyLabels.projectId, tx.projectId))
    .groupBy(storyLabels.labelId, stories.currentState)
    .all();
  const map = new Map<string, LabelCounts>();
  for (const row of rows) {
    const counts = map.get(row.labelId) ?? emptyCounts();
    const state = row.state as StoryState;
    counts.number_of_stories_by_state[state] = Number(row.cnt);
    counts.sum_of_story_estimates_by_state[state] = Number(row.estSum);
    counts.number_of_zero_point_stories_by_state[state] = Number(row.zeroCnt);
    map.set(row.labelId, counts);
  }
  return map;
}

function toLabelRow(row: typeof labels.$inferSelect, counts: Map<string, LabelCounts>): LabelRow {
  return {
    id: row.id,
    name: row.name,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    counts: counts.get(row.id) ?? emptyCounts(),
  };
}

function findLabelByNameCI(tx: ProjectTx, name: string): typeof labels.$inferSelect | undefined {
  return tx.tx
    .select()
    .from(labels)
    .where(and(eq(labels.projectId, tx.projectId), sql`${labels.name} = ${name} COLLATE NOCASE`))
    .get();
}

function insertLabel(tx: ProjectTx, name: string): typeof labels.$inferSelect {
  const now = Date.now();
  const row = { id: newId(), projectId: tx.projectId, name, createdAt: now, updatedAt: now };
  tx.tx.insert(labels).values(row).run();
  return row;
}

export function listLabels(tx: ProjectTx): LabelRow[] {
  const rows = tx.tx
    .select()
    .from(labels)
    .where(eq(labels.projectId, tx.projectId))
    .orderBy(sql`${labels.name} COLLATE NOCASE`)
    .all();
  const counts = countsByLabel(tx);
  return rows.map((row) => toLabelRow(row, counts));
}

export function createLabel(tx: ProjectTx, name: string): LabelRow {
  if (findLabelByNameCI(tx, name)) throw new HttpError(409, "label_name_taken");
  const row = insertLabel(tx, name);
  recordActivity(tx, {
    kind: "label_create_activity",
    message: `added the "${name}" label`,
    highlight: "added",
    changes: [{ kind: "label", id: row.id, change_type: "create", new_values: { name } }],
    primaryResources: [{ kind: "label", id: row.id }],
  });
  return toLabelRow(row, countsByLabel(tx));
}

export function renameLabel(tx: ProjectTx, labelId: string, name: string): LabelRow {
  const before = loadInProject(tx, labels, labelId);
  const dup = findLabelByNameCI(tx, name);
  if (dup && dup.id !== labelId) throw new HttpError(409, "label_name_taken");
  if (before.name === name) return toLabelRow(before, countsByLabel(tx));
  const now = Date.now();
  tx.tx
    .update(labels)
    .set({ name, updatedAt: now })
    .where(and(eq(labels.id, labelId), eq(labels.projectId, tx.projectId)))
    .run();
  recordActivity(tx, {
    kind: "label_update_activity",
    message: `renamed the "${before.name}" label to "${name}"`,
    highlight: "renamed",
    changes: [
      { kind: "label", id: labelId, change_type: "update", original_values: { name: before.name }, new_values: { name } },
    ],
    primaryResources: [{ kind: "label", id: labelId }],
  });
  const row = { ...before, name, updatedAt: now };
  return toLabelRow(row, countsByLabel(tx));
}

/** The FK is ON DELETE RESTRICT (schema); this check turns that constraint failure into a 409. */
export function deleteLabel(tx: ProjectTx, labelId: string): void {
  const label = loadInProject(tx, labels, labelId);
  const epic = tx.tx
    .select({ id: epics.id })
    .from(epics)
    .where(and(eq(epics.projectId, tx.projectId), eq(epics.labelId, labelId)))
    .get();
  if (epic) throw new HttpError(409, "label_backs_an_epic");
  tx.tx.delete(labels).where(and(eq(labels.id, labelId), eq(labels.projectId, tx.projectId))).run();
  recordActivity(tx, {
    kind: "label_delete_activity",
    message: `removed the "${label.name}" label`,
    highlight: "removed",
    changes: [{ kind: "label", id: labelId, change_type: "delete", original_values: { name: label.name } }],
    primaryResources: [{ kind: "label", id: labelId }],
  });
}

/** Deterministic display order matching listLabels: by name, case-insensitive. */
export function labelIds(tx: ProjectTx, storyId: string): string[] {
  return tx.tx
    .select({ id: labels.id })
    .from(storyLabels)
    .innerJoin(labels, and(eq(labels.id, storyLabels.labelId), eq(labels.projectId, storyLabels.projectId)))
    .where(and(eq(storyLabels.projectId, tx.projectId), eq(storyLabels.storyId, storyId)))
    .orderBy(sql`${labels.name} COLLATE NOCASE`)
    .all()
    .map((r) => r.id);
}

function storyNumber(tx: ProjectTx, storyId: string): number {
  return loadInProject(tx, stories, storyId).number;
}

/**
 * Attaching or detaching a label is a story edit (brief step 3), not a label edit — the label
 * itself is not created/updated/deleted by this action even when a new label is minted here.
 */
export function attachLabel(tx: ProjectTx, storyId: string, name: string): string[] {
  const number = storyNumber(tx, storyId);
  const before = labelIds(tx, storyId);
  const existing = findLabelByNameCI(tx, name);
  const label = existing ?? insertLabel(tx, name);
  tx.tx
    .insert(storyLabels)
    .values({ projectId: tx.projectId, storyId, labelId: label.id, addedAt: Date.now() })
    .onConflictDoNothing()
    .run();
  const after = labelIds(tx, storyId);
  if (before.length !== after.length || before.some((id, i) => id !== after[i])) {
    recordActivity(tx, {
      kind: "story_update_activity",
      message: "edited this story",
      highlight: "edited",
      changes: [
        { kind: "story", id: storyId, number, change_type: "update", original_values: { label_ids: before }, new_values: { label_ids: after } },
      ],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return after;
}

export function detachLabel(tx: ProjectTx, storyId: string, labelId: string): string[] {
  loadInProject(tx, labels, labelId);
  const number = storyNumber(tx, storyId);
  const before = labelIds(tx, storyId);
  tx.tx
    .delete(storyLabels)
    .where(and(eq(storyLabels.projectId, tx.projectId), eq(storyLabels.storyId, storyId), eq(storyLabels.labelId, labelId)))
    .run();
  const after = labelIds(tx, storyId);
  if (before.length !== after.length) {
    recordActivity(tx, {
      kind: "story_update_activity",
      message: "edited this story",
      highlight: "edited",
      changes: [
        { kind: "story", id: storyId, number, change_type: "update", original_values: { label_ids: before }, new_values: { label_ids: after } },
      ],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return after;
}

/** Resolves the epic's label: reuses an existing (case-insensitive) match or mints one. */
function resolveEpicLabelId(tx: ProjectTx, name: string): string {
  const existing = findLabelByNameCI(tx, name);
  if (existing) {
    const epic = tx.tx
      .select({ id: epics.id })
      .from(epics)
      .where(and(eq(epics.projectId, tx.projectId), eq(epics.labelId, existing.id)))
      .get();
    if (epic) throw new HttpError(409, "label_backs_an_epic");
    return existing.id;
  }
  return insertLabel(tx, name).id;
}

/**
 * completed_at: null unless at least one story carries the epic's label and every story that
 * carries it is accepted; otherwise the max accepted_at among them. Derived on read, not
 * stored — epics has no completed_at column and progress changes with every story transition.
 */
function epicProgress(tx: ProjectTx, labelId: string): { count: number; estimates: number; completedAt: number | null } {
  const rows = tx.tx
    .select({ state: stories.currentState, estimate: stories.estimate, acceptedAt: stories.acceptedAt })
    .from(storyLabels)
    .innerJoin(stories, and(eq(storyLabels.storyId, stories.id), eq(storyLabels.projectId, stories.projectId)))
    .where(and(eq(storyLabels.projectId, tx.projectId), eq(storyLabels.labelId, labelId)))
    .all();
  if (rows.length === 0) return { count: 0, estimates: 0, completedAt: null };
  const accepted = rows.filter((r) => r.state === "accepted");
  const allAccepted = accepted.length === rows.length;
  return {
    count: accepted.length,
    estimates: accepted.reduce((sum, r) => sum + (r.estimate ?? 0), 0),
    completedAt: allAccepted ? Math.max(...accepted.map((r) => r.acceptedAt ?? 0)) : null,
  };
}

function toEpicRow(tx: ProjectTx, row: typeof epics.$inferSelect): EpicRow {
  const progress = epicProgress(tx, row.labelId);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    label_id: row.labelId,
    position: row.position,
    past_done_stories_count: progress.count,
    past_done_story_estimates: progress.estimates,
    completed_at: progress.completedAt,
  };
}

export function listEpics(tx: ProjectTx): EpicRow[] {
  const rows = tx.tx.select().from(epics).where(eq(epics.projectId, tx.projectId)).orderBy(epics.position).all();
  return rows.map((row) => toEpicRow(tx, row));
}

export function createEpic(tx: ProjectTx, input: { name: string; description?: string | null; label_name?: string }): EpicRow {
  const labelName = input.label_name ?? input.name.toLowerCase();
  const labelId = resolveEpicLabelId(tx, labelName);
  const count = tx.tx
    .select({ n: sql<number>`count(*)` })
    .from(epics)
    .where(eq(epics.projectId, tx.projectId))
    .get();
  const position = Number(count?.n ?? 0);
  const now = Date.now();
  const id = newId();
  tx.tx
    .insert(epics)
    .values({
      id,
      projectId: tx.projectId,
      name: input.name,
      description: input.description ?? null,
      labelId,
      position,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  recordActivity(tx, {
    kind: "epic_create_activity",
    message: `added the "${input.name}" epic`,
    highlight: "added",
    changes: [{ kind: "epic", id, change_type: "create", new_values: { name: input.name, label_id: labelId } }],
    primaryResources: [{ kind: "epic", id }],
  });
  return listEpics(tx).find((e) => e.id === id)!;
}

export function updateEpic(tx: ProjectTx, epicId: string, patch: { name?: string; description?: string | null }): EpicRow {
  const before = loadInProject(tx, epics, epicId);
  const originalValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  if (patch.name !== undefined && patch.name !== before.name) {
    originalValues.name = before.name;
    newValues.name = patch.name;
  }
  if (patch.description !== undefined && patch.description !== before.description) {
    originalValues.description = before.description;
    newValues.description = patch.description;
  }
  if (Object.keys(newValues).length > 0) {
    tx.tx
      .update(epics)
      .set({
        name: patch.name ?? before.name,
        description: patch.description === undefined ? before.description : patch.description,
        updatedAt: Date.now(),
      })
      .where(and(eq(epics.id, epicId), eq(epics.projectId, tx.projectId)))
      .run();
    recordActivity(tx, {
      kind: "epic_update_activity",
      message: "edited this epic",
      highlight: "edited",
      changes: [{ kind: "epic", id: epicId, change_type: "update", original_values: originalValues, new_values: newValues }],
      primaryResources: [{ kind: "epic", id: epicId }],
    });
  }
  return listEpics(tx).find((e) => e.id === epicId)!;
}

/**
 * The API only ever names a neighbour (core-model §4.2 rule 2); the permutation is computed
 * here from the project's current order and handed to reorder() as a whole list — an
 * orderedIds array is never accepted from a client (brief step 3).
 */
export function moveEpic(tx: ProjectTx, epicId: string, move: { before_id?: string | null; after_id?: string | null }): EpicRow[] {
  loadInProject(tx, epics, epicId);
  const rows = tx.tx
    .select({ id: epics.id })
    .from(epics)
    .where(eq(epics.projectId, tx.projectId))
    .orderBy(epics.position)
    .all();
  const before = rows.map((r) => r.id);
  const without = before.filter((id) => id !== epicId);
  let insertAt = without.length;
  if (move.before_id) {
    const idx = without.indexOf(move.before_id);
    if (idx === -1) throw new HttpError(404, "not_found");
    insertAt = idx;
  } else if (move.after_id) {
    const idx = without.indexOf(move.after_id);
    if (idx === -1) throw new HttpError(404, "not_found");
    insertAt = idx + 1;
  }
  without.splice(insertAt, 0, epicId);
  // Same not-a-no-op discipline as attachLabel/detachLabel/renameLabel/updateEpic: naming a
  // neighbour the epic is already next to (or moving a single epic at all) must not write
  // reorder() or an activity row.
  if (without.some((id, i) => id !== before[i])) {
    reorder(tx, epics, eq(epics.projectId, tx.projectId), without);
    recordActivity(tx, {
      kind: "epic_move_activity",
      message: "moved this epic",
      highlight: "moved",
      changes: [{ kind: "epic", id: epicId, change_type: "update" }],
      primaryResources: [{ kind: "epic", id: epicId }],
    });
  }
  return listEpics(tx);
}

export function deleteEpic(tx: ProjectTx, epicId: string): void {
  const before = loadInProject(tx, epics, epicId);
  tx.tx.delete(epics).where(and(eq(epics.id, epicId), eq(epics.projectId, tx.projectId))).run();
  const remaining = tx.tx
    .select({ id: epics.id })
    .from(epics)
    .where(eq(epics.projectId, tx.projectId))
    .orderBy(epics.position)
    .all()
    .map((r) => r.id);
  if (remaining.length > 0) reorder(tx, epics, eq(epics.projectId, tx.projectId), remaining);
  recordActivity(tx, {
    kind: "epic_delete_activity",
    message: `removed the "${before.name}" epic`,
    highlight: "removed",
    changes: [{ kind: "epic", id: epicId, change_type: "delete", original_values: { name: before.name } }],
    primaryResources: [{ kind: "epic", id: epicId }],
  });
}
