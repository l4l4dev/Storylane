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
  "PATCH /api/projects/:id": "project:update",
  "DELETE /api/projects/:id": "project:delete",
  "POST /api/projects/:id/archive": "project:archive",
  "POST /api/projects/:id/unarchive": "project:archive",
  "GET /api/projects/:id/states": "state:read",
  "POST /api/projects/:id/states": "state:write",
  "POST /api/projects/:id/states/reorder": "state:write",
  "PATCH /api/projects/:id/states/:stateId": "state:write",
  "DELETE /api/projects/:id/states/:stateId": "state:delete",
  "GET /api/projects/:id/events": "project:read",
  "GET /api/projects/:id/board": "story:read",
  "GET /api/projects/:id/stories": "story:read",
  "POST /api/projects/:id/stories": "story:write",
  "PATCH /api/projects/:id/stories/:storyId": "story:write",
  "POST /api/projects/:id/stories/:storyId/move": "story:write",
  "DELETE /api/projects/:id/stories/:storyId": "story:delete",
};
