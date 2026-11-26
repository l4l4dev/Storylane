import { and, eq, sql } from "drizzle-orm";
import { projectMembers, users } from "../db/schema";
import type { ProjectTx } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { recordActivity } from "./activity";

export interface MembershipRow {
  user_id: string;
  role: MemberRole;
  display_name: string;
  email: string;
  initials: string;
  favorite: boolean;
  last_viewed_at: number | null;
}

/** First letter of the first word plus first letter of the last word, one letter for a single word. */
function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

const ROW = {
  userId: projectMembers.userId,
  role: projectMembers.role,
  displayName: users.displayName,
  email: users.email,
  favorite: projectMembers.favorite,
  lastViewedAt: projectMembers.lastViewedAt,
};

interface RawMembershipRow {
  userId: string;
  role: string;
  displayName: string;
  email: string;
  favorite: boolean;
  lastViewedAt: number | null;
}

function toRow(row: RawMembershipRow): MembershipRow {
  return {
    user_id: row.userId,
    role: row.role as MemberRole,
    display_name: row.displayName,
    email: row.email,
    initials: initialsOf(row.displayName),
    favorite: row.favorite,
    last_viewed_at: row.lastViewedAt,
  };
}

function selectMembership(tx: ProjectTx, userId: string) {
  return tx.tx
    .select(ROW)
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, tx.projectId), eq(projectMembers.userId, userId)))
    .get();
}

export function listMemberships(tx: ProjectTx): MembershipRow[] {
  return tx.tx
    .select(ROW)
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, tx.projectId))
    .all()
    .map(toRow);
}

function ownerCount(tx: ProjectTx): number {
  const row = tx.tx
    .select({ n: sql<number>`count(*)` })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, tx.projectId), eq(projectMembers.role, "owner")))
    .get();
  return row?.n ?? 0;
}

export function loadRole(tx: ProjectTx, userId: string): MemberRole {
  const row = tx.tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, tx.projectId), eq(projectMembers.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return row.role as MemberRole;
}

export function changeRole(tx: ProjectTx, userId: string, role: MemberRole): MembershipRow {
  const currentRole = loadRole(tx, userId);
  if (currentRole !== role) {
    if (currentRole === "owner" && ownerCount(tx) <= 1) throw new HttpError(409, "last_owner");
    tx.tx
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, tx.projectId), eq(projectMembers.userId, userId)))
      .run();
    recordActivity(tx, {
      kind: "project_membership_update_activity",
      message: `changed a member's role to ${role}`,
      highlight: "edited",
      changes: [
        {
          kind: "project_membership",
          id: userId,
          change_type: "update",
          original_values: { role: currentRole },
          new_values: { role },
        },
      ],
      primaryResources: [{ kind: "project_membership", id: userId }],
    });
  }
  return toRow(selectMembership(tx, userId)!);
}

/** Owners leave by transferring ownership and then member:leave, never by removing themselves. */
export function removeMember(tx: ProjectTx, userId: string): void {
  const currentRole = loadRole(tx, userId);
  if (tx.actor.kind === "user" && tx.actor.userId === userId) throw new HttpError(403, "forbidden");
  if (currentRole === "owner" && ownerCount(tx) <= 1) throw new HttpError(409, "last_owner");
  tx.tx
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, tx.projectId), eq(projectMembers.userId, userId)))
    .run();
  recordActivity(tx, {
    kind: "project_membership_delete_activity",
    message: "removed a member from the project",
    highlight: "removed",
    changes: [{ kind: "project_membership", id: userId, change_type: "delete" }],
    primaryResources: [{ kind: "project_membership", id: userId }],
  });
}

/**
 * member:leave is 403 for any owner (spec/permissions.md "last-owner"), so authorization has
 * already ruled out the sole-owner case by the time this runs — no last_owner check needed here.
 */
export function leaveProject(tx: ProjectTx): void {
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  const userId = tx.actor.userId;
  tx.tx
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, tx.projectId), eq(projectMembers.userId, userId)))
    .run();
  recordActivity(tx, {
    kind: "project_membership_delete_activity",
    message: "left the project",
    highlight: "left",
    changes: [{ kind: "project_membership", id: userId, change_type: "delete" }],
    primaryResources: [{ kind: "project_membership", id: userId }],
  });
}
