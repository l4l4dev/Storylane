import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  BUILT_IN_REVIEW_TYPES,
  createReview,
  createReviewType,
  deleteReview,
  listReviewTypes,
  listReviews,
  updateReview,
  updateReviewType,
} from "../src/services/reviews";
import { createProject, deleteProject } from "../src/services/projects";
import * as reviewsService from "../src/services/reviews";
import { removeMember } from "../src/services/memberships";
import { reviews } from "../src/db/schema";
import { withProject } from "../src/db/tx";
import { HttpError } from "../src/http-error";
import { makeTestDb, seedMembership, seedProject, seedStory, seedUser } from "./harness";

function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
    throw new Error("expected an HttpError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).code).toBe(code);
  }
}

function setup() {
  const db = makeTestDb();
  const owner = seedUser(db, "owner@example.test");
  const projectId = createProject(db, owner, { name: "Reviews project" }).id;
  return { db, owner, projectId };
}

describe("seedReviewTypes (via createProject)", () => {
  it("gives a new project exactly the four built-in types in order", () => {
    const { db, owner, projectId } = setup();
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    expect(types.map((t) => t.name)).toEqual([...BUILT_IN_REVIEW_TYPES]);
    expect(types.map((t) => t.position)).toEqual([0, 1, 2, 3]);
    expect(types.every((t) => t.hidden === false)).toBe(true);
  });

  it("does not seed review types for a project created outside createProject (harness seedProject)", () => {
    const db = makeTestDb();
    const owner = seedUser(db, "owner2@example.test");
    const projectId = seedProject(db, owner);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    expect(types).toEqual([]);
  });
});

describe("createReviewType", () => {
  it("refuses a duplicate name case-insensitively", () => {
    const { db, owner, projectId } = setup();
    expectHttpError(
      () => withProject(db, owner, projectId, "review-type:write", (tx) => createReviewType(tx, "design")),
      409,
      "review_type_exists",
    );
  });

  it("appends at the current count", () => {
    const { db, owner, projectId } = setup();
    const created = withProject(db, owner, projectId, "review-type:write", (tx) => createReviewType(tx, "Accessibility"));
    expect(created.position).toBe(4);
  });

  it("has no delete route or service function for review types", () => {
    expect((reviewsService as Record<string, unknown>).deleteReviewType).toBeUndefined();
  });
});

describe("updateReviewType", () => {
  it("hides a type without deleting it, and existing reviews of it stay readable/updatable", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const designType = types.find((t) => t.name === "Design")!;
    const review = withProject(db, owner, projectId, "review:write", (tx) =>
      createReview(tx, storyId, { review_type_id: designType.id }),
    );
    withProject(db, owner, projectId, "review-type:write", (tx) => updateReviewType(tx, designType.id, { hidden: true }));
    const stillListed = withProject(db, owner, projectId, "story:read", (tx) => listReviews(tx, storyId));
    expect(stillListed.map((r) => r.id)).toContain(review.id);
    const updated = withProject(db, owner, projectId, "review:write", (tx) =>
      updateReview(tx, review.id, { status: "pass" }),
    );
    expect(updated.status).toBe("pass");
  });

  it("a no-op patch writes no update and no activity", () => {
    const { db, owner, projectId } = setup();
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const designType = types.find((t) => t.name === "Design")!;
    const before = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx)).find(
      (t) => t.id === designType.id,
    )!;
    const result = withProject(db, owner, projectId, "review-type:write", (tx) =>
      updateReviewType(tx, designType.id, { name: "Design" }),
    );
    expect(result).toEqual(before);
  });
});

describe("createReview", () => {
  it("requires the reviewer to be a project member", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    expectHttpError(
      () =>
        withProject(db, owner, projectId, "review:write", (tx) =>
          createReview(tx, storyId, { review_type_id: codeType.id, reviewer_id: crypto.randomUUID() }),
        ),
      400,
      "reviewer_not_member",
    );
  });

  it("refuses a hidden review type", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    withProject(db, owner, projectId, "review-type:write", (tx) => updateReviewType(tx, codeType.id, { hidden: true }));
    expectHttpError(
      () => withProject(db, owner, projectId, "review:write", (tx) => createReview(tx, storyId, { review_type_id: codeType.id })),
      409,
      "review_type_hidden",
    );
  });

  it("rejects a status outside the four values", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    expectHttpError(
      () =>
        withProject(db, owner, projectId, "review:write", (tx) =>
          createReview(tx, storyId, { review_type_id: codeType.id, status: "bogus" as never }),
        ),
      400,
      "review_status_invalid",
    );
  });

  it("answers 409 review_exists before 400 review_status_invalid (401 → 404 → 409 → 403 → 400)", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    withProject(db, owner, projectId, "review:write", (tx) => createReview(tx, storyId, { review_type_id: codeType.id }));
    expectHttpError(
      () =>
        withProject(db, owner, projectId, "review:write", (tx) =>
          createReview(tx, storyId, { review_type_id: codeType.id, status: "bogus" as never }),
        ),
      409,
      "review_exists",
    );
  });

  it("refuses the same (story, type, reviewer) triple twice", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    withProject(db, owner, projectId, "review:write", (tx) =>
      createReview(tx, storyId, { review_type_id: codeType.id, reviewer_id: (owner as { userId: string }).userId }),
    );
    expectHttpError(
      () =>
        withProject(db, owner, projectId, "review:write", (tx) =>
          createReview(tx, storyId, { review_type_id: codeType.id, reviewer_id: (owner as { userId: string }).userId }),
        ),
      409,
      "review_exists",
    );
  });

  it("allows two null-reviewer rows to collide (409), since the intended semantics compares nulls as equal", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    withProject(db, owner, projectId, "review:write", (tx) => createReview(tx, storyId, { review_type_id: codeType.id }));
    expectHttpError(
      () => withProject(db, owner, projectId, "review:write", (tx) => createReview(tx, storyId, { review_type_id: codeType.id })),
      409,
      "review_exists",
    );
    // The unique index alone would not have stopped this (SQLite treats NULLs as distinct); the
    // service's IS-semantics check is what closes the gap.
    const raw = db.$client.query("select count(*) as n from reviews where story_id = ? and reviewer_id is null").get(storyId) as {
      n: number;
    };
    expect(raw.n).toBe(1);
  });

  it("404s on a review type from another project", () => {
    const { db, owner, projectId } = setup();
    const other = createProject(db, owner, { name: "Other" }).id;
    const storyId = seedStory(db, projectId);
    const otherTypes = withProject(db, owner, other, "story:read", (tx) => listReviewTypes(tx));
    expectHttpError(
      () =>
        withProject(db, owner, projectId, "review:write", (tx) =>
          createReview(tx, storyId, { review_type_id: otherTypes[0]!.id }),
        ),
      404,
      "not_found",
    );
  });
});

describe("updateReview", () => {
  it("changing reviewer_id into an existing triple is 409 review_exists", () => {
    const { db, owner, projectId } = setup();
    const member = seedUser(db, "member@example.test");
    seedMembership(db, projectId, member, "member");
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    withProject(db, owner, projectId, "review:write", (tx) =>
      createReview(tx, storyId, { review_type_id: codeType.id, reviewer_id: (owner as { userId: string }).userId }),
    );
    const memberReview = withProject(db, owner, projectId, "review:write", (tx) =>
      createReview(tx, storyId, { review_type_id: codeType.id, reviewer_id: (member as { userId: string }).userId }),
    );
    expectHttpError(
      () =>
        withProject(db, owner, projectId, "review:write", (tx) =>
          updateReview(tx, memberReview.id, { reviewer_id: (owner as { userId: string }).userId }),
        ),
      409,
      "review_exists",
    );
  });

  it("a no-op patch writes no update and no activity", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    const review = withProject(db, owner, projectId, "review:write", (tx) => createReview(tx, storyId, { review_type_id: codeType.id }));
    const result = withProject(db, owner, projectId, "review:write", (tx) => updateReview(tx, review.id, {}));
    expect(result).toEqual(review);
  });
});

describe("deleteReview", () => {
  it("removes the row", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    const review = withProject(db, owner, projectId, "review:write", (tx) => createReview(tx, storyId, { review_type_id: codeType.id }));
    withProject(db, owner, projectId, "review:write", (tx) => deleteReview(tx, review.id));
    const remaining = withProject(db, owner, projectId, "story:read", (tx) => listReviews(tx, storyId));
    expect(remaining).toEqual([]);
  });
});

describe("member removal (story_people_drop_on_member_removal trigger)", () => {
  it("survives the review with reviewer_id set to null, not by removing the row", () => {
    const { db, owner, projectId } = setup();
    const member = seedUser(db, "member2@example.test");
    seedMembership(db, projectId, member, "member");
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    const review = withProject(db, owner, projectId, "review:write", (tx) =>
      createReview(tx, storyId, { review_type_id: codeType.id, reviewer_id: (member as { userId: string }).userId }),
    );
    withProject(db, owner, projectId, "member:remove", (tx) => removeMember(tx, (member as { userId: string }).userId));
    const after = db.select().from(reviews).where(eq(reviews.id, review.id)).get();
    expect(after).toBeDefined();
    expect(after!.reviewerId).toBeNull();
  });
});

describe("deleteProject with a review in use", () => {
  it("deletes a project that has a review type in use by a review", () => {
    const { db, owner, projectId } = setup();
    const storyId = seedStory(db, projectId);
    const types = withProject(db, owner, projectId, "story:read", (tx) => listReviewTypes(tx));
    const codeType = types.find((t) => t.name === "Code")!;
    withProject(db, owner, projectId, "review:write", (tx) => createReview(tx, storyId, { review_type_id: codeType.id }));
    expect(() => withProject(db, owner, projectId, "project:delete", (tx) => deleteProject(tx))).not.toThrow();
  });
});
