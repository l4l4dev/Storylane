import { and, eq } from "drizzle-orm";
import { blockers, stories } from "../db/schema";
import { loadInProject, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity } from "./activity";

export interface BlockerRow {
  id: string;
  story_id: string;
  blocking_story_id: string | null;
  description: string;
  resolved: boolean;
  person_id: string;
  created_at: number;
  updated_at: number;
}

function toRow(row: typeof blockers.$inferSelect): BlockerRow {
  return {
    id: row.id,
    story_id: row.storyId,
    blocking_story_id: row.blockingStoryId,
    description: row.description,
    resolved: row.resolved,
    person_id: row.personId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function actorUserId(tx: ProjectTx): string {
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return tx.actor.userId;
}

/** The `#<n>` a description names, if that story exists in this project. */
export function referencedStoryId(tx: ProjectTx, description: string): string | null {
  const match = /#(\d+)/.exec(description);
  if (!match) return null;
  const number = Number(match[1]);
  const row = tx.tx
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.number, number)))
    .get();
  return row?.id ?? null;
}

/** Self-reference is not written: the blockers_not_self CHECK backs this as a last resort. */
function referencedOtherStoryId(tx: ProjectTx, storyId: string, description: string): string | null {
  const found = referencedStoryId(tx, description);
  return found === storyId ? null : found;
}

function isAccepted(tx: ProjectTx, storyId: string): boolean {
  const row = tx.tx
    .select({ currentState: stories.currentState })
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
    .get();
  return row?.currentState === "accepted";
}

export function listBlockers(tx: ProjectTx, storyId: string): BlockerRow[] {
  loadInProject(tx, stories, storyId);
  const rows = tx.tx
    .select()
    .from(blockers)
    .where(and(eq(blockers.projectId, tx.projectId), eq(blockers.storyId, storyId)))
    .orderBy(blockers.createdAt)
    .all();
  return rows.map(toRow);
}

export function createBlocker(tx: ProjectTx, storyId: string, description: string): BlockerRow {
  loadInProject(tx, stories, storyId);
  const blockingStoryId = referencedOtherStoryId(tx, storyId, description);
  const resolved = blockingStoryId !== null && isAccepted(tx, blockingStoryId);
  const now = Date.now();
  const id = newId();
  tx.tx
    .insert(blockers)
    .values({
      id,
      projectId: tx.projectId,
      storyId,
      blockingStoryId,
      description,
      resolved,
      personId: actorUserId(tx),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  recordActivity(tx, {
    kind: "blocker_create_activity",
    message: "added a blocker",
    highlight: "added",
    changes: [{ kind: "blocker", id, change_type: "create", new_values: { description, resolved } }],
    primaryResources: [{ kind: "story", id: storyId }],
  });
  const row = loadInProject(tx, blockers, id);
  return toRow(row);
}

export function updateBlocker(tx: ProjectTx, blockerId: string, patch: { description?: string; resolved?: boolean }): BlockerRow {
  const before = loadInProject(tx, blockers, blockerId);
  const originalValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  let blockingStoryId = before.blockingStoryId;
  if (patch.description !== undefined && patch.description !== before.description) {
    originalValues.description = before.description;
    newValues.description = patch.description;
    blockingStoryId = referencedOtherStoryId(tx, before.storyId, patch.description);
    if (blockingStoryId !== before.blockingStoryId) {
      originalValues.blocking_story_id = before.blockingStoryId;
      newValues.blocking_story_id = blockingStoryId;
    }
  }

  let resolved = before.resolved;
  if (patch.resolved !== undefined) {
    resolved = patch.resolved;
  } else if (blockingStoryId !== before.blockingStoryId) {
    // The description changed the reference: re-derive resolved from the new target, unless
    // the caller explicitly said what it wants (handled above).
    resolved = blockingStoryId !== null && isAccepted(tx, blockingStoryId);
  }
  if (resolved !== before.resolved) {
    originalValues.resolved = before.resolved;
    newValues.resolved = resolved;
  }

  if (Object.keys(newValues).length === 0) return toRow(before);

  const description = patch.description ?? before.description;
  tx.tx
    .update(blockers)
    .set({ description, blockingStoryId, resolved, updatedAt: Date.now() })
    .where(and(eq(blockers.id, blockerId), eq(blockers.projectId, tx.projectId)))
    .run();
  recordActivity(tx, {
    kind: "blocker_update_activity",
    message: "edited a blocker",
    highlight: "edited",
    changes: [{ kind: "blocker", id: blockerId, change_type: "update", original_values: originalValues, new_values: newValues }],
    primaryResources: [{ kind: "story", id: before.storyId }],
  });
  const row = loadInProject(tx, blockers, blockerId);
  return toRow(row);
}

export function deleteBlocker(tx: ProjectTx, blockerId: string): void {
  const before = loadInProject(tx, blockers, blockerId);
  tx.tx.delete(blockers).where(and(eq(blockers.id, blockerId), eq(blockers.projectId, tx.projectId))).run();
  recordActivity(tx, {
    kind: "blocker_delete_activity",
    message: "removed a blocker",
    highlight: "removed",
    changes: [{ kind: "blocker", id: blockerId, change_type: "delete", original_values: { description: before.description } }],
    primaryResources: [{ kind: "story", id: before.storyId }],
  });
}

/** Called by stories.ts when a story reaches `accepted` or is deleted (core-model §1.6.2). */
export function resolveBlockersReferencing(tx: ProjectTx, storyId: string): number {
  const rows = tx.tx
    .select()
    .from(blockers)
    .where(and(eq(blockers.projectId, tx.projectId), eq(blockers.blockingStoryId, storyId), eq(blockers.resolved, false)))
    .all();
  const now = Date.now();
  for (const row of rows) {
    tx.tx
      .update(blockers)
      .set({ resolved: true, updatedAt: now })
      .where(and(eq(blockers.id, row.id), eq(blockers.projectId, tx.projectId)))
      .run();
    recordActivity(tx, {
      kind: "blocker_update_activity",
      message: "resolved a blocker",
      highlight: "resolved",
      changes: [{ kind: "blocker", id: row.id, change_type: "update", original_values: { resolved: false }, new_values: { resolved: true } }],
      primaryResources: [{ kind: "story", id: row.storyId }],
    });
  }
  return rows.length;
}
