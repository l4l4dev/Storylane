import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { EventBus } from "../events/bus";
import type { Logger } from "../log";
import { HttpError } from "../http-error";
import {
  createProject,
  deleteProject,
  listProjects,
  readProject,
  setArchived,
  updateProject,
  type ProjectSettingsPatch,
} from "../services/projects";
import { changeRole, leaveProject, listMemberships, loadRole, removeMember } from "../services/memberships";
import { createReviewType, listReviewTypes, updateReviewType } from "../services/reviews";
import type { MemberRole } from "../authz/permissions";
import type { AttachmentStore } from "../attachments/store";
import { DESCRIPTION_MAX, NAME_MAX, assertMaxLength } from "./limits";

// A malformed body carries nothing about the project, so this 400 may answer before 404/403.
const body = async (c: Context): Promise<Record<string, unknown>> => {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_body");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "invalid_body");
  return parsed as Record<string, unknown>;
};

const ROLES: readonly MemberRole[] = ["owner", "member", "viewer"];

function requireRole(value: unknown): MemberRole {
  if (typeof value !== "string" || !ROLES.includes(value as MemberRole)) throw new HttpError(400, "role_invalid");
  return value as MemberRole;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** An unrecognized key is a caller mistake, not a field to drop. */
function rejectUnknownKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new HttpError(400, "invalid_body", `unknown field ${key}`);
  }
}

const SETTINGS_KEYS = new Set([
  "name", "description", "point_scale", "bugs_and_chores_are_estimatable", "iteration_length", "week_start_day",
  "start_date", "time_zone", "velocity_averaged_over", "initial_velocity", "number_of_done_iterations_to_show",
  "automatic_planning", "enable_tasks", "show_story_priority",
]);
const PROJECT_CREATE_KEYS = new Set(["name"]);
const MEMBERSHIP_KEYS = new Set(["role"]);
const REVIEW_TYPE_CREATE_KEYS = new Set(["name"]);
const REVIEW_TYPE_PATCH_KEYS = new Set(["name", "hidden"]);

/**
 * Shapes and bounds the PUT body; every check throws HttpError so it can run inside the
 * withProject callback (auth precedence over body validation — spec/permissions.md).
 */
function validateProjectSettingsPatch(input: Record<string, unknown>): ProjectSettingsPatch {
  rejectUnknownKeys(input, SETTINGS_KEYS);
  const patch: ProjectSettingsPatch = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) throw new HttpError(400, "name_required");
    assertMaxLength(input.name, NAME_MAX, "name_too_long");
    patch.name = input.name;
  }
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== "string") {
      throw new HttpError(400, "description_invalid");
    }
    if (typeof input.description === "string") assertMaxLength(input.description, DESCRIPTION_MAX, "description_too_long");
    patch.description = input.description as string | null;
  }
  if (input.point_scale !== undefined) {
    if (typeof input.point_scale !== "string" || input.point_scale.trim().length === 0) {
      throw new HttpError(400, "point_scale_invalid");
    }
    patch.point_scale = input.point_scale;
  }
  if (input.bugs_and_chores_are_estimatable !== undefined) {
    if (typeof input.bugs_and_chores_are_estimatable !== "boolean") throw new HttpError(400, "invalid_body");
    patch.bugs_and_chores_are_estimatable = input.bugs_and_chores_are_estimatable;
  }
  if (input.iteration_length !== undefined) {
    if (!Number.isInteger(input.iteration_length)) throw new HttpError(400, "iteration_length_invalid");
    patch.iteration_length = input.iteration_length as number;
  }
  if (input.week_start_day !== undefined) {
    if (!Number.isInteger(input.week_start_day)) throw new HttpError(400, "week_start_day_invalid");
    patch.week_start_day = input.week_start_day as number;
  }
  if (input.start_date !== undefined) {
    if (!isCalendarDate(input.start_date)) throw new HttpError(400, "start_date_invalid");
    patch.start_date = input.start_date as string;
  }
  if (input.time_zone !== undefined) {
    if (typeof input.time_zone !== "string") throw new HttpError(400, "time_zone_invalid");
    patch.time_zone = input.time_zone;
  }
  if (input.velocity_averaged_over !== undefined) {
    if (!Number.isInteger(input.velocity_averaged_over)) throw new HttpError(400, "velocity_averaged_over_invalid");
    patch.velocity_averaged_over = input.velocity_averaged_over as number;
  }
  if (input.initial_velocity !== undefined) {
    if (!Number.isInteger(input.initial_velocity)) throw new HttpError(400, "initial_velocity_invalid");
    patch.initial_velocity = input.initial_velocity as number;
  }
  if (input.number_of_done_iterations_to_show !== undefined) {
    if (!Number.isInteger(input.number_of_done_iterations_to_show)) {
      throw new HttpError(400, "number_of_done_iterations_to_show_invalid");
    }
    patch.number_of_done_iterations_to_show = input.number_of_done_iterations_to_show as number;
  }
  if (input.automatic_planning !== undefined) {
    if (typeof input.automatic_planning !== "boolean") throw new HttpError(400, "invalid_body");
    patch.automatic_planning = input.automatic_planning;
  }
  if (input.enable_tasks !== undefined) {
    if (typeof input.enable_tasks !== "boolean") throw new HttpError(400, "invalid_body");
    patch.enable_tasks = input.enable_tasks;
  }
  if (input.show_story_priority !== undefined) {
    if (typeof input.show_story_priority !== "boolean") throw new HttpError(400, "invalid_body");
    patch.show_story_priority = input.show_story_priority;
  }
  return patch;
}

export function projectRoutes(deps: {
  db: Db;
  bus: EventBus;
  log: Logger;
  actorOf: (c: Context) => Actor;
  store: AttachmentStore;
}) {
  const { db, actorOf } = deps;
  return new Hono()
    .get("/api/projects", (c) => c.json(listProjects(db, actorOf(c))))
    .post("/api/projects", async (c) => {
      // Auth precedence over body validation (spec/permissions.md): an anonymous caller must
      // get 401 even when the body is also invalid, not a 400 that leaks nothing about auth.
      // createProject re-checks this itself (it has direct callers besides this route, e.g.
      // tests and other services), so this is a deliberate short-circuit before the async body
      // parse, not a sign the service check is redundant.
      const actor = actorOf(c);
      if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
      const input = await body(c);
      rejectUnknownKeys(input, PROJECT_CREATE_KEYS);
      if (typeof input.name !== "string") throw new HttpError(400, "name_required");
      assertMaxLength(input.name, NAME_MAX, "name_too_long");
      return c.json(createProject(db, actor, { name: input.name }), 201);
    })
    .get("/api/projects/:id", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:read", (tx) => readProject(tx))),
    )
    .put("/api/projects/:id", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "project:update", (tx) =>
          updateProject(tx, validateProjectSettingsPatch(input)),
        ),
      );
    })
    .delete("/api/projects/:id", (c) => {
      const projectId = withProjectChange(deps, actorOf(c), c.req.param("id"), "project:delete", (tx) => {
        deleteProject(tx);
        return tx.projectId;
      });
      try {
        deps.store.removeProject(projectId);
      } catch (err) {
        // The rows are already gone; failing the request now would only hide a committed delete.
        deps.log.warn("project attachment bytes not removed", { projectId, message: (err as Error).message });
      }
      return c.body(null, 204);
    })
    .post("/api/projects/:id/archive", (c) =>
      c.json(withProjectChange(deps, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, true))),
    )
    .post("/api/projects/:id/unarchive", (c) =>
      c.json(withProjectChange(deps, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, false))),
    )
    .get("/api/projects/:id/memberships", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "member:read", (tx) => listMemberships(tx))),
    )
    .put("/api/projects/:id/memberships/:userId", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "member:change-role", (tx) => {
          loadRole(tx, c.req.param("userId"));
          rejectUnknownKeys(input, MEMBERSHIP_KEYS);
          return changeRole(tx, c.req.param("userId"), requireRole(input.role));
        }),
      );
    })
    .delete("/api/projects/:id/memberships/me", (c) => {
      withProjectChange(deps, actorOf(c), c.req.param("id"), "member:leave", (tx) => leaveProject(tx));
      return c.body(null, 204);
    })
    .delete("/api/projects/:id/memberships/:userId", (c) => {
      withProjectChange(deps, actorOf(c), c.req.param("id"), "member:remove", (tx) =>
        removeMember(tx, c.req.param("userId")),
      );
      return c.body(null, 204);
    })
    .get("/api/projects/:id/review_types", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => listReviewTypes(tx))),
    )
    .post("/api/projects/:id/review_types", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "review-type:write", (tx) => {
          rejectUnknownKeys(input, REVIEW_TYPE_CREATE_KEYS);
          const name = typeof input.name === "string" ? input.name.trim() : "";
          if (name.length === 0) throw new HttpError(400, "name_required");
          assertMaxLength(name, NAME_MAX, "name_too_long");
          return createReviewType(tx, name);
        }),
        201,
      );
    })
    .put("/api/projects/:id/review_types/:reviewTypeId", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "review-type:write", (tx) => {
          rejectUnknownKeys(input, REVIEW_TYPE_PATCH_KEYS);
          const patch: { name?: string; hidden?: boolean } = {};
          if (input.name !== undefined) {
            const name = typeof input.name === "string" ? input.name.trim() : "";
            if (name.length === 0) throw new HttpError(400, "name_required");
            assertMaxLength(name, NAME_MAX, "name_too_long");
            patch.name = name;
          }
          if (input.hidden !== undefined) {
            if (typeof input.hidden !== "boolean") throw new HttpError(400, "invalid_body");
            patch.hidden = input.hidden;
          }
          return updateReviewType(tx, c.req.param("reviewTypeId"), patch);
        }),
      );
    });
}
