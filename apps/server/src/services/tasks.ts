import { and, eq, sql } from "drizzle-orm";
import { stories, tasks } from "../db/schema";
import { loadInProject, reorder, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity } from "./activity";

export interface TaskRow {
  id: string;
  story_id: string;
  description: string;
  complete: boolean;
  position: number;
  created_at: number;
  updated_at: number;
}

/** Dense 0-based column position -> Tracker's 1-based wire numbering; the only place this conversion happens. */
function toTaskRow(row: typeof tasks.$inferSelect): TaskRow {
  return {
    id: row.id,
    story_id: row.storyId,
    description: row.description,
    complete: row.complete,
    position: row.position + 1,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function orderedTaskIds(tx: ProjectTx, storyId: string): string[] {
  return tx.tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, tx.projectId), eq(tasks.storyId, storyId)))
    .orderBy(tasks.position)
    .all()
    .map((r) => r.id);
}

export function listTasks(tx: ProjectTx, storyId: string): TaskRow[] {
  loadInProject(tx, stories, storyId);
  const rows = tx.tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, tx.projectId), eq(tasks.storyId, storyId)))
    .orderBy(tasks.position)
    .all();
  return rows.map(toTaskRow);
}

function loadTaskOnStory(tx: ProjectTx, taskId: string): typeof tasks.$inferSelect {
  const row = loadInProject(tx, tasks, taskId);
  return row;
}

export function createTask(tx: ProjectTx, storyId: string, input: { description: string; position?: number }): TaskRow {
  loadInProject(tx, stories, storyId);
  const before = orderedTaskIds(tx, storyId);
  const count = tx.tx
    .select({ n: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.projectId, tx.projectId), eq(tasks.storyId, storyId)))
    .get();
  const total = Number(count?.n ?? 0);
  // Wire position is 1-based and inclusive of the new task, so the valid range is 1..total+1.
  const wireAt = input.position ?? total + 1;
  if (wireAt < 1 || wireAt > total + 1) throw new HttpError(400, "position_out_of_range");
  const now = Date.now();
  const id = newId();
  // Insert at the free slot (dense count) first — inserting straight at the target position
  // would collide with the row already sitting on tasks_story_position before reorder() runs.
  tx.tx
    .insert(tasks)
    .values({
      id,
      projectId: tx.projectId,
      storyId,
      description: input.description,
      complete: false,
      position: total,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const withNew = [...before];
  withNew.splice(wireAt - 1, 0, id);
  reorder(tx, tasks, eq(tasks.storyId, storyId), withNew);
  const row = loadInProject(tx, tasks, id);
  recordActivity(tx, {
    kind: "task_create_activity",
    message: `added the "${input.description}" task`,
    highlight: "added",
    changes: [{ kind: "task", id, change_type: "create", new_values: { description: input.description, position: wireAt } }],
    primaryResources: [{ kind: "story", id: storyId }],
  });
  return toTaskRow(row);
}

export function updateTask(
  tx: ProjectTx,
  taskId: string,
  patch: { description?: string; complete?: boolean; position?: number },
): TaskRow {
  const before = loadTaskOnStory(tx, taskId);
  const storyId = before.storyId;
  const orderedIds = orderedTaskIds(tx, storyId);
  const total = orderedIds.length;

  const description = patch.description ?? before.description;
  const complete = patch.complete ?? before.complete;

  const originalValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  if (patch.description !== undefined && patch.description !== before.description) {
    originalValues.description = before.description;
    newValues.description = patch.description;
  }
  if (patch.complete !== undefined && patch.complete !== before.complete) {
    originalValues.complete = before.complete;
    newValues.complete = patch.complete;
  }

  if (patch.position !== undefined) {
    if (patch.position < 1 || patch.position > total) throw new HttpError(400, "position_out_of_range");
    const withoutTask = orderedIds.filter((id) => id !== taskId);
    withoutTask.splice(patch.position - 1, 0, taskId);
    if (withoutTask.some((id, i) => id !== orderedIds[i])) {
      originalValues.position = before.position + 1;
      newValues.position = patch.position;
      reorder(tx, tasks, eq(tasks.storyId, storyId), withoutTask);
    }
  }

  if (description !== before.description || complete !== before.complete) {
    tx.tx
      .update(tasks)
      .set({ description, complete, updatedAt: Date.now() })
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, tx.projectId)))
      .run();
  }

  if (Object.keys(newValues).length > 0) {
    recordActivity(tx, {
      kind: "task_update_activity",
      message: "edited this task",
      highlight: "edited",
      changes: [{ kind: "task", id: taskId, change_type: "update", original_values: originalValues, new_values: newValues }],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }

  const row = loadInProject(tx, tasks, taskId);
  return toTaskRow(row);
}

export function deleteTask(tx: ProjectTx, taskId: string): void {
  const before = loadTaskOnStory(tx, taskId);
  const storyId = before.storyId;
  tx.tx.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, tx.projectId))).run();
  const remaining = orderedTaskIds(tx, storyId);
  if (remaining.length > 0) reorder(tx, tasks, eq(tasks.storyId, storyId), remaining);
  recordActivity(tx, {
    kind: "task_delete_activity",
    message: `removed the "${before.description}" task`,
    highlight: "removed",
    changes: [{ kind: "task", id: taskId, change_type: "delete", original_values: { description: before.description } }],
    primaryResources: [{ kind: "story", id: storyId }],
  });
}
