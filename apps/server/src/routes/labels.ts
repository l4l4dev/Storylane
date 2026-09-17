import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { EventBus } from "../events/bus";
import type { Logger } from "../log";
import { HttpError } from "../http-error";
import {
  attachLabel,
  createEpic,
  createLabel,
  deleteEpic,
  deleteLabel,
  detachLabel,
  listEpics,
  listLabels,
  moveEpic,
  renameLabel,
  updateEpic,
} from "../services/labels";
import { readStory } from "../services/stories";
import { DESCRIPTION_MAX, NAME_MAX, assertMaxLength } from "./limits";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function rejectUnknownKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new HttpError(400, "invalid_body", `unknown field ${key}`);
  }
}

function requireName(input: Record<string, unknown>): string {
  if (typeof input.name !== "string") throw new HttpError(400, "name_required");
  assertMaxLength(input.name, NAME_MAX, "name_too_long");
  return input.name;
}

const LABEL_CREATE_KEYS = new Set(["name"]);
const LABEL_PATCH_KEYS = new Set(["name"]);
const STORY_LABEL_KEYS = new Set(["name"]);
const EPIC_CREATE_KEYS = new Set(["name", "description", "label_name"]);
const EPIC_PATCH_KEYS = new Set(["name", "description"]);
const EPIC_MOVE_KEYS = new Set(["before_id", "after_id"]);

function optionalNullableString(value: unknown, code: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, code);
  return value;
}

export function labelRoutes(deps: { db: Db; bus: EventBus; log: Logger; actorOf: (c: Context) => Actor }) {
  const { db, actorOf } = deps;
  return new Hono()
    .get("/api/projects/:id/labels", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => listLabels(tx))),
    )
    .post("/api/projects/:id/labels", async (c) => {
      const input = await body(c);
      rejectUnknownKeys(input, LABEL_CREATE_KEYS);
      const name = requireName(input);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "label:write", (tx) => createLabel(tx, name)),
        201,
      );
    })
    .put("/api/projects/:id/labels/:labelId", async (c) => {
      const input = await body(c);
      rejectUnknownKeys(input, LABEL_PATCH_KEYS);
      const name = requireName(input);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "label:write", (tx) =>
          renameLabel(tx, c.req.param("labelId"), name),
        ),
      );
    })
    .delete("/api/projects/:id/labels/:labelId", (c) => {
      withProjectChange(deps, actorOf(c), c.req.param("id"), "label:delete", (tx) =>
        deleteLabel(tx, c.req.param("labelId")),
      );
      return c.body(null, 204);
    })
    .post("/api/projects/:id/stories/:storyId/labels", async (c) => {
      const input = await body(c);
      rejectUnknownKeys(input, STORY_LABEL_KEYS);
      const name = requireName(input);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "label:write", (tx) => {
          attachLabel(tx, c.req.param("storyId"), name);
          return readStory(tx, c.req.param("storyId"));
        }),
        201,
      );
    })
    .delete("/api/projects/:id/stories/:storyId/labels/:labelId", (c) =>
      c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "label:write", (tx) => {
          detachLabel(tx, c.req.param("storyId"), c.req.param("labelId"));
          return readStory(tx, c.req.param("storyId"));
        }),
      ),
    )
    .get("/api/projects/:id/epics", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => listEpics(tx))),
    )
    .post("/api/projects/:id/epics", async (c) => {
      const input = await body(c);
      rejectUnknownKeys(input, EPIC_CREATE_KEYS);
      const name = requireName(input);
      const description = optionalNullableString(input.description, "description_invalid");
      if (description) assertMaxLength(description, DESCRIPTION_MAX, "description_too_long");
      const labelName = optionalNullableString(input.label_name, "label_name_invalid");
      if (labelName !== undefined && labelName !== null) assertMaxLength(labelName, NAME_MAX, "label_name_too_long");
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "epic:write", (tx) =>
          createEpic(tx, {
            name,
            ...(description !== undefined ? { description } : {}),
            ...(labelName ? { label_name: labelName } : {}),
          }),
        ),
        201,
      );
    })
    .put("/api/projects/:id/epics/:epicId", async (c) => {
      const input = await body(c);
      // before_id/after_id share this route with name/description so a single PUT can both
      // rename and move; splitting the two on separate URLs would cost the SPA a round trip.
      rejectUnknownKeys(input, new Set([...EPIC_PATCH_KEYS, ...EPIC_MOVE_KEYS]));
      const beforeId = optionalNullableString(input.before_id, "before_id_invalid");
      const afterId = optionalNullableString(input.after_id, "after_id_invalid");
      if (beforeId !== undefined || afterId !== undefined) {
        const move: { before_id?: string | null; after_id?: string | null } = {};
        if (beforeId !== undefined) move.before_id = beforeId;
        if (afterId !== undefined) move.after_id = afterId;
        return c.json(
          withProjectChange(deps, actorOf(c), c.req.param("id"), "epic:write", (tx) =>
            moveEpic(tx, c.req.param("epicId"), move),
          ),
        );
      }
      const patch: { name?: string; description?: string | null } = {};
      if (input.name !== undefined) patch.name = requireName(input);
      const description = optionalNullableString(input.description, "description_invalid");
      if (description !== undefined) {
        if (description !== null) assertMaxLength(description, DESCRIPTION_MAX, "description_too_long");
        patch.description = description;
      }
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "epic:write", (tx) =>
          updateEpic(tx, c.req.param("epicId"), patch),
        ),
      );
    })
    .delete("/api/projects/:id/epics/:epicId", (c) => {
      withProjectChange(deps, actorOf(c), c.req.param("id"), "epic:delete", (tx) => deleteEpic(tx, c.req.param("epicId")));
      return c.body(null, 204);
    });
}
