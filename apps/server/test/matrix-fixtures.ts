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
 * constant. Each later task adds the field its routes need (inviteId, userId).
 */
export interface MatrixContext {
  projectId: string;
  /** A pending invite in the seeded project, for the invites matrix rows. */
  inviteId: string;
  /** Any seeded user id, for the admin route's own matrix row and its anonymous/non-admin sweep rows. */
  userId: string;
  /** A seeded member who is not the sole owner, so the membership matrix rows never hit 409 last_owner. */
  memberUserId: string;
  /** A seeded story in the seeded project, for the story matrix rows. */
  storyId: string;
}

export function matrixFixtures(ctx: MatrixContext): Record<string, MatrixFixture> {
  return {
    "GET /api/projects/:id/events": { stream: true },
    "POST /api/projects/:id/invites": { body: { role: "member" } },
    "DELETE /api/projects/:id/invites/:inviteId": { params: { inviteId: ctx.inviteId } },
    "POST /api/admin/users/:userId/reset-link": { params: { userId: ctx.userId }, body: {} },
    "POST /api/me/password": { body: { currentPassword: "x", newPassword: "y" } },
    "PUT /api/projects/:id": { body: { name: "renamed by the matrix" } },
    "POST /api/projects/:id/archive": { body: {} },
    "POST /api/projects/:id/unarchive": { body: {} },
    "PUT /api/projects/:id/memberships/:userId": { params: { userId: ctx.memberUserId }, body: { role: "viewer" } },
    "DELETE /api/projects/:id/memberships/:userId": { params: { userId: ctx.memberUserId } },
    "DELETE /api/projects/:id/memberships/me": { body: {} },
    "POST /api/projects/:id/stories": { body: { name: "Matrix story" } },
    "GET /api/projects/:id/stories/:storyId": { params: { storyId: ctx.storyId } },
    "PUT /api/projects/:id/stories/:storyId": { params: { storyId: ctx.storyId }, body: { name: "Matrix" } },
    "DELETE /api/projects/:id/stories/:storyId": { params: { storyId: ctx.storyId } },
  };
}
