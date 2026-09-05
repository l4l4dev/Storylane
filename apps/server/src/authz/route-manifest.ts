import type { Action } from "./permissions";

export type RouteRule = Action | "public" | "self" | "admin" | "setup";

/** Every registered route must appear here; the matrix test enforces it. */
export const ROUTE_ACTIONS: Record<string, RouteRule> = {
  "GET /healthz": "public",
  "GET /api/projects/:id": "project:read",
};
