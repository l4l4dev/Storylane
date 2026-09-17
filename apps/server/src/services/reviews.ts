import { and, eq, isNull, sql } from "drizzle-orm";
import { reviewTypes, reviews, stories, type ReviewStatus, REVIEW_STATUSES } from "../db/schema";
import { loadInProject, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { isForeignKeyViolation } from "./story-people";
import { recordActivity, type ActivityScope } from "./activity";

/** core-model §1.7.1: Tracker's four defaults, seeded once per project in this order. */
export const BUILT_IN_REVIEW_TYPES: readonly string[] = ["Test (QA)", "Design", "Code", "Security"];

export interface ReviewTypeRow {
  id: string;
  name: string;
  hidden: boolean;
  position: number;
}

export interface ReviewRow {
  id: string;
  story_id: string;
  review_type_id: string;
  reviewer_id: string | null;
  status: ReviewStatus;
  created_at: number;
  updated_at: number;
}

function toReviewTypeRow(row: typeof reviewTypes.$inferSelect): ReviewTypeRow {
  return { id: row.id, name: row.name, hidden: row.hidden, position: row.position };
}

function toReviewRow(row: typeof reviews.$inferSelect): ReviewRow {
  return {
    id: row.id,
    story_id: row.storyId,
    review_type_id: row.reviewTypeId,
    reviewer_id: row.reviewerId,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** Run inside createProject's bootstrap transaction, beside the owner membership insert. */
export function seedReviewTypes(scope: ActivityScope): void {
  const now = Date.now();
  BUILT_IN_REVIEW_TYPES.forEach((name, position) => {
    scope.tx
      .insert(reviewTypes)
      .values({ id: newId(), projectId: scope.projectId, name, hidden: false, position, createdAt: now, updatedAt: now })
      .run();
  });
  recordActivity(scope, {
    kind: "review_type_create_activity",
    message: "added the default review types",
    highlight: "added",
    changes: [{ kind: "review_type", change_type: "create", new_values: { names: BUILT_IN_REVIEW_TYPES } }],
    primaryResources: [{ kind: "project", id: scope.projectId }],
  });
}

export function listReviewTypes(tx: ProjectTx): ReviewTypeRow[] {
  return tx.tx
    .select()
    .from(reviewTypes)
    .where(eq(reviewTypes.projectId, tx.projectId))
    .orderBy(reviewTypes.position)
    .all()
    .map(toReviewTypeRow);
}

function findReviewTypeByNameCI(tx: ProjectTx, name: string): typeof reviewTypes.$inferSelect | undefined {
  return tx.tx
    .select()
    .from(reviewTypes)
    .where(and(eq(reviewTypes.projectId, tx.projectId), sql`${reviewTypes.name} = ${name} COLLATE NOCASE`))
    .get();
}

export function createReviewType(tx: ProjectTx, name: string): ReviewTypeRow {
  if (findReviewTypeByNameCI(tx, name)) throw new HttpError(409, "review_type_exists");
  const count = tx.tx
    .select({ n: sql<number>`count(*)` })
    .from(reviewTypes)
    .where(eq(reviewTypes.projectId, tx.projectId))
    .get();
  const position = Number(count?.n ?? 0);
  const now = Date.now();
  const id = newId();
  tx.tx
    .insert(reviewTypes)
    .values({ id, projectId: tx.projectId, name, hidden: false, position, createdAt: now, updatedAt: now })
    .run();
  recordActivity(tx, {
    kind: "review_type_create_activity",
    message: `added the "${name}" review type`,
    highlight: "added",
    changes: [{ kind: "review_type", id, change_type: "create", new_values: { name } }],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
  return { id, name, hidden: false, position };
}

export function updateReviewType(tx: ProjectTx, reviewTypeId: string, patch: { name?: string; hidden?: boolean }): ReviewTypeRow {
  const before = loadInProject(tx, reviewTypes, reviewTypeId);
  const originalValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (patch.name !== undefined && patch.name !== before.name) {
    const dup = findReviewTypeByNameCI(tx, patch.name);
    if (dup && dup.id !== reviewTypeId) throw new HttpError(409, "review_type_exists");
    originalValues.name = before.name;
    newValues.name = patch.name;
  }
  if (patch.hidden !== undefined && patch.hidden !== before.hidden) {
    originalValues.hidden = before.hidden;
    newValues.hidden = patch.hidden;
  }

  if (Object.keys(newValues).length === 0) return toReviewTypeRow(before);

  const name = patch.name ?? before.name;
  const hidden = patch.hidden ?? before.hidden;
  const now = Date.now();
  tx.tx
    .update(reviewTypes)
    .set({ name, hidden, updatedAt: now })
    .where(and(eq(reviewTypes.id, reviewTypeId), eq(reviewTypes.projectId, tx.projectId)))
    .run();
  recordActivity(tx, {
    kind: "review_type_update_activity",
    message: "edited a review type",
    highlight: "edited",
    changes: [{ kind: "review_type", id: reviewTypeId, change_type: "update", original_values: originalValues, new_values: newValues }],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
  return { id: reviewTypeId, name, hidden, position: before.position };
}

function storyNumber(tx: ProjectTx, storyId: string): number {
  return loadInProject(tx, stories, storyId).number;
}

export function listReviews(tx: ProjectTx, storyId: string): ReviewRow[] {
  loadInProject(tx, stories, storyId);
  return tx.tx
    .select()
    .from(reviews)
    .where(and(eq(reviews.projectId, tx.projectId), eq(reviews.storyId, storyId)))
    .orderBy(reviews.createdAt)
    .all()
    .map(toReviewRow);
}

/**
 * SQLite treats NULLs as distinct, so the (project, story, type, reviewer) UNIQUE index does not
 * stop two rows with a null reviewer_id — compare with IS semantics explicitly.
 */
function duplicateReview(
  tx: ProjectTx,
  storyId: string,
  reviewTypeId: string,
  reviewerId: string | null,
  excludeId?: string,
): boolean {
  const reviewerMatch = reviewerId === null ? isNull(reviews.reviewerId) : eq(reviews.reviewerId, reviewerId);
  const row = tx.tx
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.projectId, tx.projectId),
        eq(reviews.storyId, storyId),
        eq(reviews.reviewTypeId, reviewTypeId),
        reviewerMatch,
      ),
    )
    .get();
  return row !== undefined && row.id !== excludeId;
}

function assertValidStatus(status: string): asserts status is ReviewStatus {
  if (!(REVIEW_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "review_status_invalid");
}

export function createReview(
  tx: ProjectTx,
  storyId: string,
  input: { review_type_id: string; reviewer_id?: string | null; status?: ReviewStatus },
): ReviewRow {
  const number = storyNumber(tx, storyId);
  const type = loadInProject(tx, reviewTypes, input.review_type_id);
  if (type.hidden) throw new HttpError(409, "review_type_hidden");
  const reviewerId = input.reviewer_id ?? null;
  const status = input.status ?? "unstarted";
  assertValidStatus(status);
  if (duplicateReview(tx, storyId, input.review_type_id, reviewerId)) throw new HttpError(409, "review_exists");
  const now = Date.now();
  const id = newId();
  try {
    tx.tx
      .insert(reviews)
      .values({
        id,
        projectId: tx.projectId,
        storyId,
        reviewTypeId: input.review_type_id,
        reviewerId,
        status,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new HttpError(400, "reviewer_not_member");
    throw err;
  }
  recordActivity(tx, {
    kind: "review_create_activity",
    message: "added a review",
    highlight: "added",
    changes: [
      { kind: "review", id, number, change_type: "create", new_values: { review_type_id: input.review_type_id, reviewer_id: reviewerId, status } },
    ],
    primaryResources: [{ kind: "story", id: storyId }],
  });
  return toReviewRow(loadInProject(tx, reviews, id));
}

export function updateReview(tx: ProjectTx, reviewId: string, patch: { reviewer_id?: string | null; status?: ReviewStatus }): ReviewRow {
  const before = loadInProject(tx, reviews, reviewId);
  const number = storyNumber(tx, before.storyId);
  const originalValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  let reviewerId = before.reviewerId;
  if (patch.reviewer_id !== undefined && patch.reviewer_id !== before.reviewerId) {
    if (duplicateReview(tx, before.storyId, before.reviewTypeId, patch.reviewer_id, reviewId)) {
      throw new HttpError(409, "review_exists");
    }
    reviewerId = patch.reviewer_id;
    originalValues.reviewer_id = before.reviewerId;
    newValues.reviewer_id = reviewerId;
  }

  let status = before.status;
  if (patch.status !== undefined && patch.status !== before.status) {
    assertValidStatus(patch.status);
    status = patch.status;
    originalValues.status = before.status;
    newValues.status = status;
  }

  if (Object.keys(newValues).length === 0) return toReviewRow(before);

  const now = Date.now();
  try {
    tx.tx
      .update(reviews)
      .set({ reviewerId, status, updatedAt: now })
      .where(and(eq(reviews.id, reviewId), eq(reviews.projectId, tx.projectId)))
      .run();
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new HttpError(400, "reviewer_not_member");
    throw err;
  }
  recordActivity(tx, {
    kind: "review_update_activity",
    message: "edited a review",
    highlight: "edited",
    changes: [{ kind: "review", id: reviewId, number, change_type: "update", original_values: originalValues, new_values: newValues }],
    primaryResources: [{ kind: "story", id: before.storyId }],
  });
  return toReviewRow(loadInProject(tx, reviews, reviewId));
}

export function deleteReview(tx: ProjectTx, reviewId: string): void {
  const before = loadInProject(tx, reviews, reviewId);
  const number = storyNumber(tx, before.storyId);
  tx.tx.delete(reviews).where(and(eq(reviews.id, reviewId), eq(reviews.projectId, tx.projectId))).run();
  recordActivity(tx, {
    kind: "review_delete_activity",
    message: "removed a review",
    highlight: "removed",
    changes: [{ kind: "review", id: reviewId, number, change_type: "delete" }],
    primaryResources: [{ kind: "story", id: before.storyId }],
  });
}
