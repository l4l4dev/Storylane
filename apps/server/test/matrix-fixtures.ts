import type { Role } from "../src/authz/permissions";

/**
 * Per-route data the matrix needs to make a *valid* request, so a 4xx it asserts comes from
 * authorization and not from a missing path param or body. Keys match ROUTE_ACTIONS exactly.
 */
export interface MatrixFixture {
  /** Values for path params other than :id (which is always the seeded project). */
  params?: Record<string, string>;
  /** JSON body for non-GET routes. */
  body?: unknown;
  /** Raw (non-JSON) request body, sent with its own content type and extra headers. */
  rawBody?: { contentType: string; headers?: Record<string, string>; bytes: string };
  /** Server-sent-events route: cancel the body once the status is known. */
  stream?: boolean;
  /** Overrides for the roles whose expected answer depends on who owns the row. */
  perRole?: Partial<Record<Role, MatrixFixture>>;
}

/** The roles that can author a row; anonymous and non-member rows reuse the owner's. */
export type AuthorRole = "viewer" | "member" | "owner";

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
  /** A seeded label backing no epic, for the label matrix rows (deleting it must not 409). */
  labelId: string;
  /** A seeded epic (with its own label) in the seeded project, for the epic matrix rows. */
  epicId: string;
  /** A seeded task on ctx.storyId, for the task matrix rows. */
  taskId: string;
  /** A seeded blocker on ctx.storyId, for the blocker matrix rows. */
  blockerId: string;
  /** One comment on ctx.storyId per authoring role, written by that role's own user. */
  commentIds: Record<AuthorRole, string>;
  /** One attachment per authoring role, uploaded by that role's user onto its own comment. */
  attachmentIds: Record<AuthorRole, string>;
}

function ownRow(ids: Record<AuthorRole, string>, build: (id: string) => MatrixFixture): MatrixFixture {
  return {
    ...build(ids.owner),
    perRole: { viewer: build(ids.viewer), member: build(ids.member), owner: build(ids.owner) },
  };
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
    "POST /api/projects/:id/stories/:storyId/owners/:userId": { params: { storyId: ctx.storyId, userId: ctx.memberUserId }, body: {} },
    "DELETE /api/projects/:id/stories/:storyId/owners/:userId": { params: { storyId: ctx.storyId, userId: ctx.memberUserId } },
    "POST /api/projects/:id/stories/:storyId/follow": { params: { storyId: ctx.storyId }, body: {} },
    "DELETE /api/projects/:id/stories/:storyId/follow": { params: { storyId: ctx.storyId } },
    "POST /api/projects/:id/stories/:storyId/followers/:userId": { params: { storyId: ctx.storyId, userId: ctx.memberUserId }, body: {} },
    "DELETE /api/projects/:id/stories/:storyId/followers/:userId": { params: { storyId: ctx.storyId, userId: ctx.memberUserId } },
    "POST /api/projects/:id/labels": { body: { name: "Matrix new label" } },
    "PUT /api/projects/:id/labels/:labelId": { params: { labelId: ctx.labelId }, body: { name: "Matrix renamed" } },
    "DELETE /api/projects/:id/labels/:labelId": { params: { labelId: ctx.labelId } },
    "POST /api/projects/:id/stories/:storyId/labels": { params: { storyId: ctx.storyId }, body: { name: "matrix-story-label" } },
    "DELETE /api/projects/:id/stories/:storyId/labels/:labelId": { params: { storyId: ctx.storyId, labelId: ctx.labelId } },
    "GET /api/projects/:id/epics": {},
    "POST /api/projects/:id/epics": { body: { name: "Matrix epic" } },
    "PUT /api/projects/:id/epics/:epicId": { params: { epicId: ctx.epicId }, body: { name: "Matrix epic renamed" } },
    "DELETE /api/projects/:id/epics/:epicId": { params: { epicId: ctx.epicId } },
    "GET /api/projects/:id/stories/:storyId/tasks": { params: { storyId: ctx.storyId } },
    "POST /api/projects/:id/stories/:storyId/tasks": { params: { storyId: ctx.storyId }, body: { description: "Matrix task" } },
    "PUT /api/projects/:id/stories/:storyId/tasks/:taskId": {
      params: { storyId: ctx.storyId, taskId: ctx.taskId },
      body: { description: "Matrix task renamed" },
    },
    "DELETE /api/projects/:id/stories/:storyId/tasks/:taskId": { params: { storyId: ctx.storyId, taskId: ctx.taskId } },
    "GET /api/projects/:id/stories/:storyId/comments": { params: { storyId: ctx.storyId } },
    "POST /api/projects/:id/stories/:storyId/comments": { params: { storyId: ctx.storyId }, body: { text: "Matrix comment" } },
    "PUT /api/projects/:id/stories/:storyId/comments/:commentId": ownRow(ctx.commentIds, (commentId) => ({
      params: { storyId: ctx.storyId, commentId },
      body: { text: "Matrix comment edited" },
    })),
    "DELETE /api/projects/:id/stories/:storyId/comments/:commentId": ownRow(ctx.commentIds, (commentId) => ({
      params: { storyId: ctx.storyId, commentId },
    })),
    "POST /api/projects/:id/stories/:storyId/comments/:commentId/attachments": ownRow(ctx.commentIds, (commentId) => ({
      params: { storyId: ctx.storyId, commentId },
      rawBody: {
        contentType: "application/octet-stream",
        headers: { "x-filename": "matrix.txt", "x-content-type": "text/plain" },
        bytes: "matrix bytes",
      },
    })),
    "GET /api/projects/:id/attachments/:attachmentId": { params: { attachmentId: ctx.attachmentIds.owner } },
    "DELETE /api/projects/:id/attachments/:attachmentId": ownRow(ctx.attachmentIds, (attachmentId) => ({
      params: { attachmentId },
    })),
    "GET /api/projects/:id/stories/:storyId/blockers": { params: { storyId: ctx.storyId } },
    "POST /api/projects/:id/stories/:storyId/blockers": { params: { storyId: ctx.storyId }, body: { description: "Matrix blocker" } },
    "PUT /api/projects/:id/stories/:storyId/blockers/:blockerId": {
      params: { storyId: ctx.storyId, blockerId: ctx.blockerId },
      body: { description: "Matrix blocker edited" },
    },
    "DELETE /api/projects/:id/stories/:storyId/blockers/:blockerId": { params: { storyId: ctx.storyId, blockerId: ctx.blockerId } },
  };
}
