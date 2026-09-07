import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { invites, projectMembers, projects, users } from "../db/schema";
import { loadInProject, type ProjectTx, type UserActor } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { hashToken, newSecret } from "../auth/tokens";
import { bootstrapScope, recordActivity } from "./activity";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteRow {
  id: string;
  role: MemberRole;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

export interface InvitePreview {
  projectId: string;
  projectName: string;
  role: MemberRole;
}

const ROW = {
  id: invites.id,
  role: invites.role,
  createdAt: invites.createdAt,
  expiresAt: invites.expiresAt,
  acceptedAt: invites.acceptedAt,
  revokedAt: invites.revokedAt,
};

export function mintInvite(tx: ProjectTx, input: { role: MemberRole; now?: number }): { token: string; invite: InviteRow } {
  const now = input.now ?? Date.now();
  const token = newSecret();
  const id = newId();
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  tx.tx
    .insert(invites)
    .values({
      id,
      projectId: tx.projectId,
      tokenHash: hashToken(token),
      role: input.role,
      createdBy: tx.actor.userId,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    })
    .run();
  recordActivity(tx, { action: "member.invited", payload: { role: input.role } });
  const invite = tx.tx.select(ROW).from(invites).where(eq(invites.id, id)).get() as InviteRow;
  return { token, invite };
}

export function listInvites(tx: ProjectTx): InviteRow[] {
  return tx.tx
    .select(ROW)
    .from(invites)
    .where(eq(invites.projectId, tx.projectId))
    .orderBy(invites.createdAt)
    .all() as InviteRow[];
}

export function revokeInvite(tx: ProjectTx, inviteId: string, now = Date.now()): InviteRow {
  loadInProject(tx, invites, inviteId);
  tx.tx.update(invites).set({ revokedAt: now }).where(eq(invites.id, inviteId)).run();
  recordActivity(tx, { action: "member.invite_revoked" });
  return tx.tx.select(ROW).from(invites).where(eq(invites.id, inviteId)).get() as InviteRow;
}

/** A bad, expired, revoked or already-used token is one indistinguishable 404. */
function usable(db: Db, token: string, now: number) {
  const row = db
    .select({
      id: invites.id,
      projectId: invites.projectId,
      role: invites.role,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
      projectName: projects.name,
    })
    .from(invites)
    .innerJoin(projects, eq(projects.id, invites.projectId))
    .where(eq(invites.tokenHash, hashToken(token)))
    .get();
  if (!row || row.revokedAt !== null || row.acceptedAt !== null || now >= row.expiresAt) return null;
  return row;
}

export function previewInvite(db: Db, token: string, now = Date.now()): InvitePreview | null {
  const row = usable(db, token, now);
  if (!row) return null;
  return { projectId: row.projectId, projectName: row.projectName, role: row.role as MemberRole };
}

/**
 * Not project-scoped: the actor is not a member yet, so there is nothing for withProject to
 * authorize — the token is the authorization. Runs as one immediate transaction.
 */
export function acceptInvite(db: Db, token: string, actor: UserActor, now = Date.now()): InvitePreview {
  return db.transaction(
    (tx) => {
      const row = usable(db, token, now);
      if (!row) throw new HttpError(404, "not_found");
      const existing = tx
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, row.projectId), eq(projectMembers.userId, actor.userId)))
        .get();
      const role = (existing?.role ?? row.role) as MemberRole;
      if (!existing) {
        tx.insert(projectMembers)
          .values({ projectId: row.projectId, userId: actor.userId, role: row.role, joinedAt: now })
          .run();
        recordActivity(bootstrapScope(tx, row.projectId, actor), {
          action: "member.joined",
          payload: { role: row.role, via: "invite" },
        });
      }
      tx.update(invites).set({ acceptedAt: now, acceptedBy: actor.userId }).where(eq(invites.id, row.id)).run();
      return { projectId: row.projectId, projectName: row.projectName, role };
    },
    { behavior: "immediate" },
  );
}

/** Accepting while logged out: register, then join. The password is hashed by the route. */
export function registerAndAcceptInvite(
  db: Db,
  token: string,
  user: { email: string; displayName: string; passwordHash: string },
  now = Date.now(),
): { userId: string; preview: InvitePreview } {
  const userId = db.transaction(
    (tx) => {
      if (usable(db, token, now) === null) throw new HttpError(404, "not_found");
      // users.email is UNIQUE COLLATE NOCASE, so the lookup must use the same collation.
      const taken = tx
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.email} = ${user.email} collate nocase`)
        .get();
      if (taken) throw new HttpError(409, "email_taken");
      const id = newId();
      tx.insert(users)
        .values({
          id,
          email: user.email,
          passwordHash: user.passwordHash,
          displayName: user.displayName,
          isAdmin: false,
          createdAt: now,
        })
        .run();
      return id;
    },
    { behavior: "immediate" },
  );
  const preview = acceptInvite(db, token, { kind: "user", userId, isAdmin: false }, now);
  return { userId, preview };
}
