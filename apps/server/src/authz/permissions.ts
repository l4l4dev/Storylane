import fixture from "../../../../spec/fixtures/permissions.json";

/** TS widens the JSON array to string[], so the union is spelled out and reconciled below. */
export type Role = "anonymous" | "non-member" | "viewer" | "member" | "owner";
export type MemberRole = Exclude<Role, "anonymous" | "non-member">;
export type Action = keyof typeof fixture.actions;
export type Expect = 200 | 401 | 403 | 404;

export const ROLES: readonly Role[] = ["anonymous", "non-member", "viewer", "member", "owner"];

const CODES: readonly number[] = [200, 401, 403, 404];

const actions = fixture.actions as Record<Action, Record<Role, Expect>>;

export const ALL_ACTIONS = Object.keys(actions) as Action[];

/**
 * Validates a permissions fixture's shape and the anonymous/non-member pin. Exported so the
 * load-time check below and its test share one implementation instead of drifting apart.
 */
export function validatePermissionsFixture(f: { roles: readonly string[]; actions: Record<string, Record<string, unknown>> }): void {
  if (f.roles.length !== ROLES.length || f.roles.some((r) => !ROLES.includes(r as Role))) {
    throw new Error("spec/fixtures/permissions.json roles no longer match the Role union");
  }
  for (const action of Object.keys(f.actions)) {
    const row = f.actions[action] as Record<string, unknown>;
    const cells = Object.keys(row);
    if (cells.length !== ROLES.length || ROLES.some((r) => !cells.includes(r))) {
      throw new Error(`permissions fixture: ${action} must have exactly the roles ${ROLES.join(", ")}, got ${cells.join(", ")}`);
    }
    for (const role of ROLES) {
      if (!CODES.includes(row[role] as number)) {
        throw new Error(`permissions fixture: ${action}/${role} is ${String(row[role])}, expected one of ${CODES.join(", ")}`);
      }
    }
    if (row["anonymous"] !== 401 || row["non-member"] !== 404) {
      throw new Error(`permissions fixture: ${action} must be 401 for anonymous and 404 for non-member`);
    }
  }
}

// Validate at module load, so a broken fixture fails at boot instead of at request time.
validatePermissionsFixture(fixture);

export function expected(action: Action, role: Role): Expect {
  const row = actions[action];
  if (!row) throw new Error(`unknown action ${action}`);
  return row[role];
}

/** The matrix has no write/read column; the action name carries it. */
export function isWrite(action: Action): boolean {
  return !action.endsWith(":read");
}
