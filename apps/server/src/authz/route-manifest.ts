import type { Action } from "./permissions";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteRule = Action | "public" | "self" | "admin" | "setup";

/** Every registered route must appear here; the matrix test enforces it. */
export const ROUTE_ACTIONS: Record<`${Method} ${string}`, RouteRule> = {
  "GET /healthz": "public",
  "POST /api/auth/login": "public",
  "POST /api/auth/logout": "self",
  "GET /api/me": "self",
  "POST /api/me/password": "self",
  "GET /api/setup": "setup",
  "POST /api/setup": "setup",
  "GET /api/projects": "self",
  "POST /api/projects": "self",
  "GET /api/projects/:id": "project:read",
  "PUT /api/projects/:id": "project:update",
  "DELETE /api/projects/:id": "project:delete",
  "POST /api/projects/:id/archive": "project:archive",
  "POST /api/projects/:id/unarchive": "project:archive",
  "GET /api/projects/:id/memberships": "member:read",
  "PUT /api/projects/:id/memberships/:userId": "member:change-role",
  "DELETE /api/projects/:id/memberships/me": "member:leave",
  "DELETE /api/projects/:id/memberships/:userId": "member:remove",
  "POST /api/projects/:id/invites": "member:invite",
  "GET /api/projects/:id/invites": "invite:read",
  "DELETE /api/projects/:id/invites/:inviteId": "member:invite",
  "GET /api/invites/:token": "public",
  "POST /api/invites/:token/accept": "public",
  "POST /api/admin/users/:userId/reset-link": "admin",
  "GET /api/auth/reset/:token": "public",
  "POST /api/auth/reset/:token": "public",
  "GET /api/projects/:id/events": "project:read",
  "GET /api/projects/:id/activity": "activity:read",
  "GET /api/projects/:id/stories": "story:read",
  "POST /api/projects/:id/stories": "story:write",
  "GET /api/projects/:id/stories/:storyId": "story:read",
  "PUT /api/projects/:id/stories/:storyId": "story:write",
  "DELETE /api/projects/:id/stories/:storyId": "story:delete",
};
