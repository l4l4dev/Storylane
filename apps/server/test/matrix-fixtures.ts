/**
 * Per-route data the matrix needs to make a *valid* request, so a 4xx it asserts comes from
 * authorization and not from a missing path param or body. Keys match ROUTE_ACTIONS exactly.
 */
export interface MatrixFixture {
  /** Values for path params other than :id (which is always the seeded project). */
  params?: Record<string, string>;
  /** JSON body for non-GET routes. */
  body?: unknown;
  /** Server-sent-events route: cancel the body once the status is known. */
  stream?: boolean;
}

/**
 * Ids the fixtures need are seeded per test run, so this is a function of them rather than a
 * constant. Each later task adds the field its routes need (stateId, storyId, inviteId, userId).
 */
export interface MatrixContext {
  projectId: string;
  /** A spare state the matrix may PATCH and DELETE without breaking the category minimum. */
  stateId: string;
  /** The project's states, in position order — a valid permutation for the reorder fixture. */
  stateIds: string[];
  /** A story in the seeded project the matrix may read, PATCH, move and (freshly seeded) DELETE. */
  storyId: string;
  /** The Icebox column's ids after the move — what `reorder` demands the move fixture name. */
  iceboxOrder: string[];
}

export function matrixFixtures(ctx: MatrixContext): Record<string, MatrixFixture> {
  return {
    "POST /api/me/password": { body: { currentPassword: "x", newPassword: "y" } },
    "PATCH /api/projects/:id": { body: { name: "renamed by the matrix" } },
    "POST /api/projects/:id/archive": { body: {} },
    "POST /api/projects/:id/unarchive": { body: {} },
    "POST /api/projects/:id/states": { body: { name: "Matrix", category: "in_progress" } },
    "POST /api/projects/:id/states/reorder": { body: { orderedIds: ctx.stateIds } },
    "PATCH /api/projects/:id/states/:stateId": { params: { stateId: ctx.stateId }, body: { name: "Matrix" } },
    "DELETE /api/projects/:id/states/:stateId": { params: { stateId: ctx.stateId } },
    "POST /api/projects/:id/stories": { body: { title: "Matrix story" } },
    "PATCH /api/projects/:id/stories/:storyId": { params: { storyId: ctx.storyId }, body: { title: "Matrix" } },
    "POST /api/projects/:id/stories/:storyId/move": {
      params: { storyId: ctx.storyId },
      body: { stateId: null, orderedIds: ctx.iceboxOrder },
    },
    "DELETE /api/projects/:id/stories/:storyId": { params: { storyId: ctx.storyId } },
  };
}
