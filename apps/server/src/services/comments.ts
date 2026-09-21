import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { comments, epics, fileAttachments, projectMembers, stories, users } from "../db/schema";
import { loadInProject, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity, type ActivityResourceRef } from "./activity";
import { ensureFollowing } from "./story-people";

export interface FileAttachmentRow {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  uploader_id: string;
  created_at: number;
  download_url: string;
}

export interface CommentRow {
  id: string;
  story_id: string | null;
  epic_id: string | null;
  text: string;
  person_id: string;
  created_at: number;
  updated_at: number;
  file_attachments: FileAttachmentRow[];
}

type Parent = { storyId?: string; epicId?: string };

function actorUserId(tx: ProjectTx): string {
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return tx.actor.userId;
}

function toAttachmentRow(tx: ProjectTx, row: typeof fileAttachments.$inferSelect): FileAttachmentRow {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.contentType,
    size: row.size,
    uploader_id: row.uploaderId,
    created_at: row.createdAt,
    download_url: `/api/projects/${tx.projectId}/attachments/${row.id}`,
  };
}

function attachmentsOf(tx: ProjectTx, commentIds: string[]): Map<string, FileAttachmentRow[]> {
  const byComment = new Map<string, FileAttachmentRow[]>();
  if (commentIds.length === 0) return byComment;
  const rows = tx.tx
    .select()
    .from(fileAttachments)
    .where(and(eq(fileAttachments.projectId, tx.projectId), inArray(fileAttachments.commentId, commentIds)))
    .orderBy(asc(fileAttachments.createdAt), asc(fileAttachments.id))
    .all();
  for (const row of rows) {
    const list = byComment.get(row.commentId) ?? [];
    list.push(toAttachmentRow(tx, row));
    byComment.set(row.commentId, list);
  }
  return byComment;
}

function toCommentRow(row: typeof comments.$inferSelect, files: FileAttachmentRow[]): CommentRow {
  return {
    id: row.id,
    story_id: row.storyId,
    epic_id: row.epicId,
    text: row.text,
    person_id: row.personId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    file_attachments: files,
  };
}

function readComment(tx: ProjectTx, commentId: string): CommentRow {
  const row = loadInProject(tx, comments, commentId);
  return toCommentRow(row, attachmentsOf(tx, [row.id]).get(row.id) ?? []);
}

/** Validates the parent and returns its activity resource; exactly one of the two must be given. */
function parentRef(tx: ProjectTx, parent: Parent): ActivityResourceRef {
  if ((parent.storyId === undefined) === (parent.epicId === undefined)) {
    throw new Error("a comment needs exactly one of storyId or epicId");
  }
  if (parent.storyId !== undefined) {
    loadInProject(tx, stories, parent.storyId);
    return { kind: "story", id: parent.storyId };
  }
  loadInProject(tx, epics, parent.epicId!);
  return { kind: "epic", id: parent.epicId! };
}

function parentOf(row: typeof comments.$inferSelect): ActivityResourceRef {
  return row.storyId !== null ? { kind: "story", id: row.storyId } : { kind: "epic", id: row.epicId! };
}

function followMentions(tx: ProjectTx, row: typeof comments.$inferSelect, text: string): void {
  if (row.storyId === null) return;
  for (const userId of mentionedUserIds(tx, text)) ensureFollowing(tx, row.storyId, userId);
}

function isOwner(tx: ProjectTx): boolean {
  return tx.role === "owner";
}

export function listComments(tx: ProjectTx, parent: Parent): CommentRow[] {
  parentRef(tx, parent);
  const rows = tx.tx
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.projectId, tx.projectId),
        parent.storyId !== undefined ? eq(comments.storyId, parent.storyId) : isNull(comments.storyId),
        parent.epicId !== undefined ? eq(comments.epicId, parent.epicId) : isNull(comments.epicId),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all();
  const files = attachmentsOf(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toCommentRow(r, files.get(r.id) ?? []));
}

export function createComment(tx: ProjectTx, parent: Parent, text: string): CommentRow {
  const ref = parentRef(tx, parent);
  const personId = actorUserId(tx);
  const now = Date.now();
  const id = newId();
  tx.tx
    .insert(comments)
    .values({
      id,
      projectId: tx.projectId,
      storyId: parent.storyId ?? null,
      epicId: parent.epicId ?? null,
      text,
      personId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = loadInProject(tx, comments, id);
  if (row.storyId !== null) ensureFollowing(tx, row.storyId, personId);
  followMentions(tx, row, text);
  recordActivity(tx, {
    kind: "comment_create_activity",
    message: `added comment: "${text}"`,
    highlight: "added comment:",
    changes: [{ kind: "comment", id, change_type: "create", new_values: { text, person_id: personId } }],
    primaryResources: [{ kind: "comment", id }, ref],
  });
  return toCommentRow(row, []);
}

export function updateComment(tx: ProjectTx, commentId: string, text: string): CommentRow {
  const before = loadInProject(tx, comments, commentId);
  if (before.personId !== actorUserId(tx)) throw new HttpError(403, "not_comment_author");
  if (before.text === text) return readComment(tx, commentId);
  tx.tx
    .update(comments)
    .set({ text, updatedAt: Date.now() })
    .where(and(eq(comments.id, commentId), eq(comments.projectId, tx.projectId)))
    .run();
  followMentions(tx, before, text);
  recordActivity(tx, {
    kind: "comment_update_activity",
    message: `edited comment: "${text}"`,
    highlight: "edited comment:",
    changes: [
      { kind: "comment", id: commentId, change_type: "update", original_values: { text: before.text }, new_values: { text } },
    ],
    primaryResources: [{ kind: "comment", id: commentId }, parentOf(before)],
  });
  return readComment(tx, commentId);
}

export function deleteComment(tx: ProjectTx, commentId: string): { storagePaths: string[] } {
  const before = loadInProject(tx, comments, commentId);
  if (before.personId !== actorUserId(tx) && !isOwner(tx)) throw new HttpError(403, "forbidden");
  const storagePaths = tx.tx
    .select({ storagePath: fileAttachments.storagePath })
    .from(fileAttachments)
    .where(and(eq(fileAttachments.projectId, tx.projectId), eq(fileAttachments.commentId, commentId)))
    .all()
    .map((r) => r.storagePath);
  tx.tx.delete(comments).where(and(eq(comments.id, commentId), eq(comments.projectId, tx.projectId))).run();
  recordActivity(tx, {
    kind: "comment_delete_activity",
    message: "deleted comment",
    highlight: "deleted comment",
    changes: [{ kind: "comment", id: commentId, change_type: "delete", original_values: { text: before.text } }],
    primaryResources: [{ kind: "comment", id: commentId }, parentOf(before)],
  });
  return { storagePaths };
}

function touchComment(tx: ProjectTx, commentId: string): void {
  tx.tx
    .update(comments)
    .set({ updatedAt: Date.now() })
    .where(and(eq(comments.id, commentId), eq(comments.projectId, tx.projectId)))
    .run();
}

export function attachFile(
  tx: ProjectTx,
  commentId: string,
  meta: { id: string; filename: string; contentType: string; size: number; storagePath: string },
): FileAttachmentRow {
  const comment = loadInProject(tx, comments, commentId);
  const uploaderId = actorUserId(tx);
  // Attaching modifies the comment, so it follows comment:update-own: the author only.
  if (comment.personId !== uploaderId) throw new HttpError(403, "not_comment_author");
  tx.tx
    .insert(fileAttachments)
    .values({
      id: meta.id,
      projectId: tx.projectId,
      commentId,
      filename: meta.filename,
      contentType: meta.contentType,
      size: meta.size,
      storagePath: meta.storagePath,
      uploaderId,
      createdAt: Date.now(),
    })
    .run();
  touchComment(tx, commentId);
  recordActivity(tx, {
    kind: "comment_update_activity",
    message: `attached "${meta.filename}"`,
    highlight: "attached",
    changes: [
      { kind: "file_attachment", id: meta.id, change_type: "create", new_values: { filename: meta.filename } },
      { kind: "comment", id: commentId, change_type: "update" },
    ],
    primaryResources: [{ kind: "comment", id: commentId }, parentOf(comment)],
  });
  return toAttachmentRow(tx, loadInProject(tx, fileAttachments, meta.id));
}

export function readAttachment(tx: ProjectTx, attachmentId: string): FileAttachmentRow & { storage_path: string } {
  const row = loadInProject(tx, fileAttachments, attachmentId);
  return { ...toAttachmentRow(tx, row), storage_path: row.storagePath };
}

export function detachFile(tx: ProjectTx, attachmentId: string): { storagePath: string } {
  const row = loadInProject(tx, fileAttachments, attachmentId);
  // attachment:delete follows comment:delete: the uploader or any project owner.
  if (row.uploaderId !== actorUserId(tx) && !isOwner(tx)) throw new HttpError(403, "forbidden");
  const comment = loadInProject(tx, comments, row.commentId);
  tx.tx
    .delete(fileAttachments)
    .where(and(eq(fileAttachments.id, attachmentId), eq(fileAttachments.projectId, tx.projectId)))
    .run();
  touchComment(tx, row.commentId);
  recordActivity(tx, {
    kind: "comment_update_activity",
    message: `removed "${row.filename}"`,
    highlight: "removed",
    changes: [
      { kind: "file_attachment", id: attachmentId, change_type: "delete", original_values: { filename: row.filename } },
      { kind: "comment", id: row.commentId, change_type: "update" },
    ],
    primaryResources: [{ kind: "comment", id: row.commentId }, parentOf(comment)],
  });
  return { storagePath: row.storagePath };
}

/** Storage paths of every attachment under this story's comments; the route unlinks them once the delete commits. */
export function storyAttachmentPaths(tx: ProjectTx, storyId: string): string[] {
  return tx.tx
    .select({ storagePath: fileAttachments.storagePath })
    .from(fileAttachments)
    .innerJoin(
      comments,
      and(eq(comments.id, fileAttachments.commentId), eq(comments.projectId, fileAttachments.projectId)),
    )
    .where(and(eq(fileAttachments.projectId, tx.projectId), eq(comments.storyId, storyId)))
    .all()
    .map((r) => r.storagePath);
}

const MENTION = /@([\p{L}\p{N}._+-]+)/gu;

/** @mention -> user ids, resolved against this project's members only. */
export function mentionedUserIds(tx: ProjectTx, text: string): string[] {
  // Sentence punctuation after a mention ("thanks @alice.") is not part of the name.
  const tokens = new Set([...text.matchAll(MENTION)].map((m) => m[1]!.replace(/[._-]+$/, "").toLowerCase()));
  tokens.delete("");
  if (tokens.size === 0) return [];
  const byLocalPart = new Map<string, string[]>();
  const members = tx.tx
    .select({ userId: users.id, email: users.email })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, tx.projectId))
    .all();
  for (const m of members) {
    const local = m.email.slice(0, m.email.lastIndexOf("@")).toLowerCase();
    byLocalPart.set(local, [...(byLocalPart.get(local) ?? []), m.userId]);
  }
  const ids: string[] = [];
  for (const token of tokens) {
    const matches = byLocalPart.get(token);
    if (matches?.length === 1 && !ids.includes(matches[0]!)) ids.push(matches[0]!);
  }
  return ids;
}
