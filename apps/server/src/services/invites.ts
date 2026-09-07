import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { invites, projectMembers, projects, users } from "../db/schema";
import { assertNoOpenTransaction, loadInProject, type ProjectTx, type UserActor } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { hashToken, newSecret } from "../auth/tokens";
import { bootstrapScope, recordActivity } from "./activity";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Owner invitations are not allowed in phase 1 (spec/permissions.md "Invitations"). */
export type InviteRole = Exclude<MemberRole, "owner">;

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

/** `acceptInvite`'s internal result: `changed` tells the route whether to publish. */
interface AcceptResult extends InvitePreview {
  /** False when the caller was already a member and nothing was written. */
  changed: boolean;
}

const ROW = {
  id: invites.id,
  role: invites.role,
  createdAt: invites.createdAt,
  expiresAt: invites.expiresAt,
  acceptedAt: invites.acceptedAt,
  revokedAt: invites.revokedAt,
};

export function mintInvite(tx: ProjectTx, input: { role: InviteRole; now?: number }): { token: string; invite: InviteRow } {
  const now = input.now ?? Date.now();
  const token = newSecret();
  const id = newId();
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  // Defense in depth: InviteRole excludes "owner" at the type level, but a caller reached
  // through JS (not TS) must not be able to mint one by widening the value at runtime.
  if ((input.role as MemberRole) === "owner") throw new HttpError(400, "role_invalid");
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
  const invite = tx.tx
    .select(ROW)
    .from(invites)
    .where(and(eq(invites.id, id), eq(invites.projectId, tx.projectId)))
    .get() as InviteRow;
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
  const scoped = and(eq(invites.id, inviteId), eq(invites.projectId, tx.projectId));
  tx.tx.update(invites).set({ revokedAt: now }).where(scoped).run();
  recordActivity(tx, { action: "member.invite_revoked" });
  return tx.tx.select(ROW).from(invites).where(scoped).get() as InviteRow;
}

/**
 * A bad, expired, revoked, already-used, owner-role, or archived-project token is one
 * indistinguishable 404 — an invite into an archived project must not become a side door
 * around the project's write lock (spec/permissions.md "Archived project"), and an
 * owner-role row (mintInvite refuses to create one, but this is the read-side backstop) must
 * never be honoured even if one ever reaches the table by another path.
 *
 * `reader` is `{ select }` rather than `Db`, so a caller inside a transaction passes its own
 * `tx` (never the plain `db` — see setup/setup-token.ts's readTokenRow for the same split).
 */
function usable(reader: Pick<Db, "select">, token: string, now: number) {
  const row = reader
    .select({
      id: invites.id,
      projectId: invites.projectId,
      role: invites.role,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
      projectName: projects.name,
      archivedAt: projects.archivedAt,
    })
    .from(invites)
    .innerJoin(projects, eq(projects.id, invites.projectId))
    .where(eq(invites.tokenHash, hashToken(token)))
    .get();
  if (
    !row ||
    row.revokedAt !== null ||
    row.acceptedAt !== null ||
    now >= row.expiresAt ||
    row.archivedAt !== null ||
    row.role === "owner"
  ) {
    return null;
  }
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
export function acceptInvite(db: Db, token: string, actor: UserActor, now = Date.now()): AcceptResult {
  assertNoOpenTransaction("acceptInvite");
  return db.transaction(
    (tx) => {
      const row = usable(tx, token, now);
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
        // Only a join that actually changed membership consumes the invite: an already-member
        // accepting a leaked link must not be able to burn the token for the person it was
        // meant for.
        tx.update(invites).set({ acceptedAt: now, acceptedBy: actor.userId }).where(eq(invites.id, row.id)).run();
      }
      return { projectId: row.projectId, projectName: row.projectName, role, changed: !existing };
    },
    { behavior: "immediate" },
  );
}

/**
 * Accepting while logged out: register, create the membership, stamp the invite as accepted,
 * and log the join — all in ONE immediate transaction, guarded by assertNoOpenTransaction like
 * every other top-level write in this codebase (createProject, changePassword, ...).
 *
 * This must not be two transactions (register, then a separate acceptInvite call): a token
 * that a concurrent revoke/expiry/accept invalidates between them would otherwise leave a
 * brand-new user account behind with no membership and no way to retry — an orphaned account
 * nothing else in this codebase produces. One transaction means the token recheck and the
 * user/membership writes either all land together or none do.
 *
 * The password is hashed by the route, outside this transaction: bun:sqlite transactions here
 * are synchronous, and hashPassword is async.
 */
export function registerAndAcceptInvite(
  db: Db,
  token: string,
  user: { email: string; displayName: string; passwordHash: string },
  now = Date.now(),
): { userId: string; preview: InvitePreview } {
  assertNoOpenTransaction("registerAndAcceptInvite");
  return db.transaction(
    (tx) => {
      const row = usable(tx, token, now);
      if (!row) throw new HttpError(404, "not_found");
      // users.email is UNIQUE COLLATE NOCASE, so the lookup must use the same collation. A
      // duplicate answers the same 400 as any other malformed body — it must not read
      // differently on the wire from "email_required" etc. (no email-existence oracle).
      const taken = tx
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.email} = ${user.email} collate nocase`)
        .get();
      if (taken) throw new HttpError(400, "invalid_body");
      const userId = newId();
      tx.insert(users)
        .values({
          id: userId,
          email: user.email,
          passwordHash: user.passwordHash,
          displayName: user.displayName,
          isAdmin: false,
          createdAt: now,
        })
        .run();
      const actor: UserActor = { kind: "user", userId, isAdmin: false };
      tx.insert(projectMembers)
        .values({ projectId: row.projectId, userId, role: row.role, joinedAt: now })
        .run();
      recordActivity(bootstrapScope(tx, row.projectId, actor), {
        action: "member.joined",
        payload: { role: row.role, via: "invite" },
      });
      tx.update(invites).set({ acceptedAt: now, acceptedBy: userId }).where(eq(invites.id, row.id)).run();
      return { userId, preview: { projectId: row.projectId, projectName: row.projectName, role: row.role as MemberRole } };
    },
    { behavior: "immediate" },
  );
}
