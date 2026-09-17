import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { EventBus } from "../events/bus";
import type { Logger } from "../log";
import { HttpError } from "../http-error";
import { ATTACHMENT_MAX_BYTES, type AttachmentStore } from "../attachments/store";
import {
  attachFile,
  createComment,
  deleteComment,
  detachFile,
  listComments,
  readAttachment,
  updateComment,
} from "../services/comments";
import { newId } from "../id";
import { createTask, deleteTask, listTasks, updateTask } from "../services/tasks";
import { DESCRIPTION_MAX, FILENAME_MAX, assertMaxLength } from "./limits";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function rejectUnknownKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new HttpError(400, "invalid_body", `unknown field ${key}`);
  }
}

const COMMENT_KEYS = new Set(["text"]);
const COMMENT_TEXT_MAX = 20000;

/** "" is legal: an attachment-only comment carries no text. */
function requireText(input: Record<string, unknown>): string {
  if (typeof input.text !== "string") throw new HttpError(400, "text_required");
  assertMaxLength(input.text, COMMENT_TEXT_MAX, "text_too_long");
  return input.text;
}

function commentOnStory<T extends { id: string }>(rows: T[], commentId: string): T {
  const row = rows.find((r) => r.id === commentId);
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

const PLAUSIBLE_MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

/** Keeps the `type/subtype` essence of a media type; anything implausible becomes octet-stream. */
export function safeContentType(recorded: string | undefined): string {
  const essence = (recorded ?? "").split(";")[0]!.trim().toLowerCase();
  return PLAUSIBLE_MEDIA_TYPE.test(essence) ? essence : "application/octet-stream";
}

function uploadFilename(header: string | undefined): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(header ?? "");
  } catch {
    throw new HttpError(400, "filename_invalid");
  }
  const trimmed = decoded.trim();
  assertMaxLength(trimmed, FILENAME_MAX, "filename_too_long");
  return trimmed === "" ? "file" : trimmed;
}

/** Refuses an upload by its declared length before a single byte is buffered. */
function declaredUploadLength(header: string | undefined): number {
  if (header === undefined || !/^\d+$/.test(header)) throw new HttpError(400, "file_required");
  const length = Number(header);
  if (length > ATTACHMENT_MAX_BYTES) throw new HttpError(413, "attachment_too_large");
  if (length === 0) throw new HttpError(400, "file_required");
  return length;
}

/**
 * Always `attachment`, never `inline`: an uploaded HTML file must not execute on the app's origin.
 * The ASCII fallback drops anything that could end the quoted string or the header line.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename
    .replace(/["\\\u0000-\u001f\u007f]/g, "")
    .replace(/[^\u0020-\u007e]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii === "" ? "file" : ascii}"; filename*=UTF-8''${encoded}`;
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

export function removeQuietly(log: Logger, store: AttachmentStore, storagePaths: string[]): void {
  for (const storagePath of storagePaths) {
    try {
      store.remove(storagePath);
    } catch (err) {
      // The rows are already gone; failing the request now would only hide a committed delete.
      log.warn("attachment bytes not removed", { storagePath, message: (err as Error).message });
    }
  }
}

export function storyPartRoutes(deps: {
  db: Db;
  bus: EventBus;
  log: Logger;
  actorOf: (c: Context) => Actor;
  store: AttachmentStore;
}) {
  const { db, actorOf, store, log } = deps;
  return new Hono()
    .get("/api/projects/:id/stories/:storyId/comments", (c) =>
      c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) =>
          listComments(tx, { storyId: c.req.param("storyId") }),
        ),
      ),
    )
    .post("/api/projects/:id/stories/:storyId/comments", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "comment:create", (tx) => {
          rejectUnknownKeys(input, COMMENT_KEYS);
          return createComment(tx, { storyId: c.req.param("storyId") }, requireText(input));
        }),
        201,
      );
    })
    .put("/api/projects/:id/stories/:storyId/comments/:commentId", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "comment:update-own", (tx) => {
          const row = commentOnStory(listComments(tx, { storyId: c.req.param("storyId") }), c.req.param("commentId"));
          // Mirrors updateComment's author check so a stranger's malformed body still answers 403, not 400.
          if (tx.actor.kind !== "user" || row.person_id !== tx.actor.userId) throw new HttpError(403, "not_comment_author");
          rejectUnknownKeys(input, COMMENT_KEYS);
          return updateComment(tx, c.req.param("commentId"), requireText(input));
        }),
      );
    })
    .delete("/api/projects/:id/stories/:storyId/comments/:commentId", (c) => {
      const { storagePaths } = withProjectChange(deps, actorOf(c), c.req.param("id"), "comment:delete", (tx) => {
        commentOnStory(listComments(tx, { storyId: c.req.param("storyId") }), c.req.param("commentId"));
        return deleteComment(tx, c.req.param("commentId"));
      });
      removeQuietly(log, store, storagePaths);
      return c.body(null, 204);
    })
    .post("/api/projects/:id/stories/:storyId/comments/:commentId/attachments", async (c) => {
      const actor = actorOf(c);
      if (actor.kind === "anonymous") throw new HttpError(401, "unauthenticated");
      // Size is checked before membership, so a non-member's oversized upload answers 413 rather
      // than 404; the limit is the same for every project and says nothing about this one.
      const declared = declaredUploadLength(c.req.header("content-length"));
      const bytes = await c.req.arrayBuffer();
      if (bytes.byteLength === 0) throw new HttpError(400, "file_required");
      if (bytes.byteLength > ATTACHMENT_MAX_BYTES || bytes.byteLength > declared) {
        throw new HttpError(413, "attachment_too_large");
      }
      if (bytes.byteLength !== declared) throw new HttpError(400, "file_length_mismatch");
      const filename = uploadFilename(c.req.header("x-filename"));
      const contentType = safeContentType(c.req.header("x-content-type"));
      // The storage path must not come from the URL: authorize first so the directory is named by
      // the project id the database resolved, and a caller with no access writes no bytes at all.
      const projectId = withProject(db, actor, c.req.param("id"), "attachment:write", (tx) => tx.projectId);
      const id = newId();
      const storagePath = store.put(projectId, id, bytes);
      try {
        return c.json(
          withProjectChange(deps, actor, projectId, "attachment:write", (tx) => {
            commentOnStory(listComments(tx, { storyId: c.req.param("storyId") }), c.req.param("commentId"));
            return attachFile(tx, c.req.param("commentId"), {
              id,
              filename,
              contentType,
              size: bytes.byteLength,
              storagePath,
            });
          }),
          201,
        );
      } catch (err) {
        removeQuietly(log, store, [storagePath]);
        throw err;
      }
    })
    .get("/api/projects/:id/attachments/:attachmentId", (c) => {
      const row = withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) =>
        readAttachment(tx, c.req.param("attachmentId")),
      );
      const bytes = store.read(row.storage_path);
      return c.body(bytes, 200, {
        "Content-Type": safeContentType(row.content_type),
        "Content-Disposition": contentDisposition(row.filename),
        "Content-Length": String(bytes.byteLength),
      });
    })
    .delete("/api/projects/:id/attachments/:attachmentId", (c) => {
      const { storagePath } = withProjectChange(deps, actorOf(c), c.req.param("id"), "attachment:delete", (tx) =>
        detachFile(tx, c.req.param("attachmentId")),
      );
      removeQuietly(log, store, [storagePath]);
      return c.body(null, 204);
    })
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
