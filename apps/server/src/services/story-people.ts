import { and, eq } from "drizzle-orm";
import { stories, storyFollowers, storyOwners } from "../db/schema";
import { loadInProject, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { recordActivity } from "./activity";

const FK_FAILED_MESSAGE = "FOREIGN KEY constraint failed";

/** bun:sqlite sets `.code` on a constraint violation; the message check is a fallback only. */
export function isForeignKeyViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true;
  return err.message.includes(FK_FAILED_MESSAGE);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function ownerIds(tx: ProjectTx, storyId: string): string[] {
  return tx.tx
    .select({ userId: storyOwners.userId })
    .from(storyOwners)
    .where(and(eq(storyOwners.projectId, tx.projectId), eq(storyOwners.storyId, storyId)))
    .orderBy(storyOwners.addedAt, storyOwners.userId)
    .all()
    .map((r) => r.userId);
}

export function followerIds(tx: ProjectTx, storyId: string): string[] {
  return tx.tx
    .select({ userId: storyFollowers.userId })
    .from(storyFollowers)
    .where(and(eq(storyFollowers.projectId, tx.projectId), eq(storyFollowers.storyId, storyId)))
    .orderBy(storyFollowers.followedAt, storyFollowers.userId)
    .all()
    .map((r) => r.userId);
}

/**
 * The matrix grants a viewer follower:write; the self-restriction is not expressible there.
 * Applied to the owner pair too, as defence in depth — those routes are story:write-gated so a
 * viewer never reaches them, but the service must not rely on the route manifest alone.
 */
function assertMayActOnBehalfOf(tx: ProjectTx, userId: string): void {
  if (tx.role !== "viewer") return;
  if (tx.actor.kind === "user" && tx.actor.userId === userId) return;
  throw new HttpError(403, "forbidden");
}

function storyNumber(tx: ProjectTx, storyId: string): number {
  return loadInProject(tx, stories, storyId).number;
}

/** Automatic follow (core-model §1.5.2): no self-restriction, and it never fails a caller's request. */
export function ensureFollowing(tx: ProjectTx, storyId: string, userId: string): void {
  try {
    tx.tx
      .insert(storyFollowers)
      .values({ projectId: tx.projectId, storyId, userId, followedAt: Date.now() })
      .onConflictDoNothing()
      .run();
  } catch (err) {
    // Not a project member (e.g. a stale @mention): nothing to follow with, and not this
    // caller's mistake to report.
    if (isForeignKeyViolation(err)) return;
    throw err;
  }
}

export function addOwner(
  tx: ProjectTx,
  storyId: string,
  userId: string,
  opts: { recordActivity?: boolean } = {},
): string[] {
  // Story lookup (404) before the self-restriction (403): existence precedes authorization detail.
  const number = storyNumber(tx, storyId);
  assertMayActOnBehalfOf(tx, userId);
  const before = ownerIds(tx, storyId);
  try {
    tx.tx
      .insert(storyOwners)
      .values({ projectId: tx.projectId, storyId, userId, addedAt: Date.now() })
      .onConflictDoNothing()
      .run();
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new HttpError(400, "owner_not_member");
    throw err;
  }
  ensureFollowing(tx, storyId, userId);
  const after = ownerIds(tx, storyId);
  if ((opts.recordActivity ?? true) && !sameIds(before, after)) {
    recordActivity(tx, {
      kind: "story_update_activity",
      message: "edited this story",
      highlight: "edited",
      changes: [
        { kind: "story", id: storyId, number, change_type: "update", original_values: { owner_ids: before }, new_values: { owner_ids: after } },
      ],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return after;
}

export function removeOwner(
  tx: ProjectTx,
  storyId: string,
  userId: string,
  opts: { recordActivity?: boolean } = {},
): string[] {
  const number = storyNumber(tx, storyId);
  assertMayActOnBehalfOf(tx, userId);
  const before = ownerIds(tx, storyId);
  tx.tx
    .delete(storyOwners)
    .where(and(eq(storyOwners.projectId, tx.projectId), eq(storyOwners.storyId, storyId), eq(storyOwners.userId, userId)))
    .run();
  const after = ownerIds(tx, storyId);
  if ((opts.recordActivity ?? true) && !sameIds(before, after)) {
    recordActivity(tx, {
      kind: "story_update_activity",
      message: "edited this story",
      highlight: "edited",
      changes: [
        { kind: "story", id: storyId, number, change_type: "update", original_values: { owner_ids: before }, new_values: { owner_ids: after } },
      ],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return after;
}

export function addFollower(tx: ProjectTx, storyId: string, userId: string): string[] {
  const number = storyNumber(tx, storyId);
  assertMayActOnBehalfOf(tx, userId);
  const before = followerIds(tx, storyId);
  try {
    tx.tx
      .insert(storyFollowers)
      .values({ projectId: tx.projectId, storyId, userId, followedAt: Date.now() })
      .onConflictDoNothing()
      .run();
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new HttpError(400, "follower_not_member");
    throw err;
  }
  const after = followerIds(tx, storyId);
  if (!sameIds(before, after)) {
    recordActivity(tx, {
      kind: "follower_create_activity",
      message: "is now following this story",
      highlight: "followed",
      changes: [
        { kind: "story", id: storyId, number, change_type: "update", original_values: { follower_ids: before }, new_values: { follower_ids: after } },
      ],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return after;
}

export function removeFollower(tx: ProjectTx, storyId: string, userId: string): string[] {
  const number = storyNumber(tx, storyId);
  assertMayActOnBehalfOf(tx, userId);
  const before = followerIds(tx, storyId);
  tx.tx
    .delete(storyFollowers)
    .where(and(eq(storyFollowers.projectId, tx.projectId), eq(storyFollowers.storyId, storyId), eq(storyFollowers.userId, userId)))
    .run();
  const after = followerIds(tx, storyId);
  if (!sameIds(before, after)) {
    recordActivity(tx, {
      kind: "follower_delete_activity",
      message: "stopped following this story",
      highlight: "unfollowed",
      changes: [
        { kind: "story", id: storyId, number, change_type: "update", original_values: { follower_ids: before }, new_values: { follower_ids: after } },
      ],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return after;
}
