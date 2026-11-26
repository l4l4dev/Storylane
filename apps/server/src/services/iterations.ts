import { and, eq } from "drizzle-orm";
import { iterationOverrides } from "../db/schema";
import type { ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { recordActivity } from "./activity";

export interface IterationOverrideRow {
  number: number;
  length: number | null;
  team_strength: number;
}

/** The activity sentinel for "no override" (core-model §5.1); never a real length value. */
const DEFAULT_LENGTH = "default";

function assertNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400, "iteration_number_invalid");
}

function assertLength(length: number | null | undefined): void {
  if (length === undefined || length === null) return;
  if (!Number.isInteger(length) || length < 1 || length > 99) throw new HttpError(400, "length_invalid");
}

function assertTeamStrength(teamStrength: number | undefined): void {
  if (teamStrength === undefined) return;
  if (!Number.isFinite(teamStrength) || teamStrength < 0 || teamStrength > 10) {
    throw new HttpError(400, "team_strength_invalid");
  }
}

function toRow(row: { number: number; length: number | null; teamStrength: number }): IterationOverrideRow {
  return { number: row.number, length: row.length, team_strength: row.teamStrength };
}

function find(tx: ProjectTx, number: number): typeof iterationOverrides.$inferSelect | undefined {
  return tx.tx
    .select()
    .from(iterationOverrides)
    .where(and(eq(iterationOverrides.projectId, tx.projectId), eq(iterationOverrides.number, number)))
    .get();
}

export function listIterationOverrides(tx: ProjectTx): IterationOverrideRow[] {
  return tx.tx
    .select()
    .from(iterationOverrides)
    .where(eq(iterationOverrides.projectId, tx.projectId))
    .orderBy(iterationOverrides.number)
    .all()
    .map(toRow);
}

export function putIterationOverride(
  tx: ProjectTx,
  number: number,
  patch: { length?: number | null; team_strength?: number },
): IterationOverrideRow {
  assertNumber(number);
  if (patch.length === undefined && patch.team_strength === undefined) {
    throw new HttpError(400, "override_empty");
  }
  assertLength(patch.length);
  assertTeamStrength(patch.team_strength);

  const before = find(tx, number);
  const beforeLength = before?.length ?? null;
  const beforeTeamStrength = before?.teamStrength ?? 1;
  const newLength = patch.length !== undefined ? patch.length : beforeLength;
  const newTeamStrength = patch.team_strength !== undefined ? patch.team_strength : beforeTeamStrength;

  if (newLength === beforeLength && newTeamStrength === beforeTeamStrength) {
    return before ? toRow(before) : { number, length: null, team_strength: 1 };
  }

  const now = Date.now();
  if (before) {
    tx.tx
      .update(iterationOverrides)
      .set({ length: newLength, teamStrength: newTeamStrength, updatedAt: now })
      .where(and(eq(iterationOverrides.projectId, tx.projectId), eq(iterationOverrides.number, number)))
      .run();
  } else {
    tx.tx
      .insert(iterationOverrides)
      .values({ projectId: tx.projectId, number, length: newLength, teamStrength: newTeamStrength, createdAt: now, updatedAt: now })
      .run();
  }
  recordActivity(tx, {
    kind: "iteration_update_activity",
    message: `edited iteration ${number}`,
    highlight: "edited",
    changes: [
      {
        kind: "iteration_override",
        id: tx.projectId,
        change_type: before ? "update" : "create",
        original_values: { number, length: beforeLength ?? DEFAULT_LENGTH, team_strength: beforeTeamStrength },
        new_values: { number, length: newLength ?? DEFAULT_LENGTH, team_strength: newTeamStrength },
      },
    ],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
  return { number, length: newLength, team_strength: newTeamStrength };
}

export function deleteIterationOverride(tx: ProjectTx, number: number): void {
  assertNumber(number);
  const before = find(tx, number);
  if (!before) return;
  tx.tx
    .delete(iterationOverrides)
    .where(and(eq(iterationOverrides.projectId, tx.projectId), eq(iterationOverrides.number, number)))
    .run();
  recordActivity(tx, {
    kind: "iteration_update_activity",
    message: `reset iteration ${number} to the project default`,
    highlight: "reset",
    changes: [
      {
        kind: "iteration_override",
        id: tx.projectId,
        change_type: "delete",
        original_values: { number, length: before.length ?? DEFAULT_LENGTH, team_strength: before.teamStrength },
        new_values: { number, length: DEFAULT_LENGTH, team_strength: 1 },
      },
    ],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
}
