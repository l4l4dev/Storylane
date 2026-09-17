import { and, eq } from "drizzle-orm";
import { stories, storyFollowers, storyOwners } from "../db/schema";
import { loadInProject, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { recordActivity } from "./activity";

const FK_FAILED = "FOREIGN KEY constraint failed";

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

/** The matrix grants a viewer follower:write; the self-restriction is not expressible there. */
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
    if (err instanceof Error && err.message.includes(FK_FAILED)) return;
    throw err;
  }
}

export function addOwner(
  tx: ProjectTx,
  storyId: string,
  userId: string,
  opts: { recordActivity?: boolean } = {},
): string[] {
  const number = storyNumber(tx, storyId);
  try {
    tx.tx
      .insert(storyOwners)
      .values({ projectId: tx.projectId, storyId, userId, addedAt: Date.now() })
      .onConflictDoNothing()
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes(FK_FAILED)) throw new HttpError(400, "owner_not_member");
    throw err;
  }
  ensureFollowing(tx, storyId, userId);
  const after = ownerIds(tx, storyId);
  if (opts.recordActivity ?? true) {
    recordActivity(tx, {
      kind: "story_update_activity",
      message: "edited this story",
      highlight: "edited",
      changes: [{ kind: "story", id: storyId, number, change_type: "update", new_values: { owner_ids: after } }],
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
  tx.tx
    .delete(storyOwners)
    .where(and(eq(storyOwners.projectId, tx.projectId), eq(storyOwners.storyId, storyId), eq(storyOwners.userId, userId)))
    .run();
  const after = ownerIds(tx, storyId);
  if (opts.recordActivity ?? true) {
    recordActivity(tx, {
      kind: "story_update_activity",
      message: "edited this story",
      highlight: "edited",
      changes: [{ kind: "story", id: storyId, number, change_type: "update", new_values: { owner_ids: after } }],
      primaryResources: [{ kind: "story", id: storyId }],
    });
  }
  return after;
}

export function addFollower(tx: ProjectTx, storyId: string, userId: string): string[] {
  assertMayActOnBehalfOf(tx, userId);
  const number = storyNumber(tx, storyId);
  try {
    tx.tx
      .insert(storyFollowers)
      .values({ projectId: tx.projectId, storyId, userId, followedAt: Date.now() })
      .onConflictDoNothing()
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes(FK_FAILED)) throw new HttpError(400, "follower_not_member");
    throw err;
  }
  const after = followerIds(tx, storyId);
  recordActivity(tx, {
    kind: "follower_create_activity",
    message: "is now following this story",
    highlight: "followed",
    changes: [{ kind: "story", id: storyId, number, change_type: "update", new_values: { follower_ids: after } }],
    primaryResources: [{ kind: "story", id: storyId }],
  });
  return after;
}

export function removeFollower(tx: ProjectTx, storyId: string, userId: string): string[] {
  assertMayActOnBehalfOf(tx, userId);
  const number = storyNumber(tx, storyId);
  tx.tx
    .delete(storyFollowers)
    .where(and(eq(storyFollowers.projectId, tx.projectId), eq(storyFollowers.storyId, storyId), eq(storyFollowers.userId, userId)))
    .run();
  const after = followerIds(tx, storyId);
  recordActivity(tx, {
    kind: "follower_delete_activity",
    message: "stopped following this story",
    highlight: "unfollowed",
    changes: [{ kind: "story", id: storyId, number, change_type: "update", new_values: { follower_ids: after } }],
    primaryResources: [{ kind: "story", id: storyId }],
  });
  return after;
}
