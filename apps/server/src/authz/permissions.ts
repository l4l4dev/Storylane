import fixture from "../../../../spec/fixtures/permissions.json";

/** TS widens the JSON array to string[], so the union is spelled out and reconciled below. */
export type Role = "anonymous" | "non-member" | "viewer" | "member" | "owner";
export type MemberRole = Exclude<Role, "anonymous" | "non-member">;
export type Action = keyof typeof fixture.actions;
export type Expect = 200 | 401 | 403 | 404;

export const ROLES: readonly Role[] = ["anonymous", "non-member", "viewer", "member", "owner"];

const actions = fixture.actions as Record<Action, Record<Role, Expect>>;

export const ALL_ACTIONS = Object.keys(actions) as Action[];

// Fail at boot, not at request time, if the fixture and this module drift apart.
if (fixture.roles.length !== ROLES.length || fixture.roles.some((r) => !ROLES.includes(r as Role))) {
  throw new Error("spec/fixtures/permissions.json roles no longer match the Role union");
}
for (const action of ALL_ACTIONS) {
  for (const role of ROLES) {
    if (actions[action][role] === undefined) throw new Error(`permissions fixture: ${action} has no ${role} column`);
  }
}

export function expected(action: Action, role: Role): Expect {
  const row = actions[action];
  if (!row) throw new Error(`unknown action ${action}`);
  return row[role];
}

/** The matrix has no write/read column; the action name carries it. */
export function isWrite(action: Action): boolean {
  return !action.endsWith(":read");
}
