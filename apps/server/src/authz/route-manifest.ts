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
  "GET /api/projects/:id": "project:read",
};
