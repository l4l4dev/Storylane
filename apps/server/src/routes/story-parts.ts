import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { EventBus } from "../events/bus";
import type { Logger } from "../log";
import { HttpError } from "../http-error";
import { createTask, deleteTask, listTasks, updateTask } from "../services/tasks";
import { DESCRIPTION_MAX, assertMaxLength } from "./limits";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function rejectUnknownKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new HttpError(400, "invalid_body", `unknown field ${key}`);
  }
}

const TASK_CREATE_KEYS = new Set(["description", "position"]);
const TASK_PATCH_KEYS = new Set(["description", "complete", "position"]);

function requireDescription(input: Record<string, unknown>): string {
  if (typeof input.description !== "string") throw new HttpError(400, "description_required");
  const trimmed = input.description.trim();
  if (trimmed.length === 0) throw new HttpError(400, "description_required");
  assertMaxLength(input.description, DESCRIPTION_MAX, "description_too_long");
  return input.description;
}

function optionalPosition(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new HttpError(400, "position_invalid");
  return value;
}

/** taskId belongs to the project but not to :storyId — a 404, same as any other foreign resource. */
function assertTaskOnStory(rows: { id: string }[], taskId: string): void {
  if (!rows.some((r) => r.id === taskId)) throw new HttpError(404, "not_found");
}

export function storyPartRoutes(deps: { db: Db; bus: EventBus; log: Logger; actorOf: (c: Context) => Actor }) {
  const { db, actorOf } = deps;
  return new Hono()
    .get("/api/projects/:id/stories/:storyId/tasks", (c) =>
      c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => listTasks(tx, c.req.param("storyId"))),
      ),
    )
    .post("/api/projects/:id/stories/:storyId/tasks", async (c) => {
      const input = await body(c);
      rejectUnknownKeys(input, TASK_CREATE_KEYS);
      const description = requireDescription(input);
      const position = optionalPosition(input.position);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "task:write", (tx) =>
          createTask(tx, c.req.param("storyId"), { description, ...(position !== undefined ? { position } : {}) }),
        ),
        201,
      );
    })
    .put("/api/projects/:id/stories/:storyId/tasks/:taskId", async (c) => {
      const input = await body(c);
      rejectUnknownKeys(input, TASK_PATCH_KEYS);
      const patch: { description?: string; complete?: boolean; position?: number } = {};
      if (input.description !== undefined) patch.description = requireDescription(input);
      if (input.complete !== undefined) {
        if (typeof input.complete !== "boolean") throw new HttpError(400, "complete_invalid");
        patch.complete = input.complete;
      }
      const position = optionalPosition(input.position);
      if (position !== undefined) patch.position = position;
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "task:write", (tx) => {
          const tasks = listTasks(tx, c.req.param("storyId"));
          assertTaskOnStory(tasks, c.req.param("taskId"));
          return updateTask(tx, c.req.param("taskId"), patch);
        }),
      );
    })
    .delete("/api/projects/:id/stories/:storyId/tasks/:taskId", (c) => {
      withProjectChange(deps, actorOf(c), c.req.param("id"), "task:write", (tx) => {
        const tasks = listTasks(tx, c.req.param("storyId"));
        assertTaskOnStory(tasks, c.req.param("taskId"));
        deleteTask(tx, c.req.param("taskId"));
      });
      return c.body(null, 204);
    });
}
