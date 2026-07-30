const NON_MEMBER_ASSIGNEE_MESSAGE =
  "That person is no longer a member of this project — pick a different assignee.";

// TASK-221's composite FK. A member removal that lands between the client
// reading the assignee list and the write reaching Postgres is the only way a
// user meets this, so the message names the recovery rather than the constraint.
const NON_MEMBER_ASSIGNEE_CONSTRAINT = "stories_assignee_project_fkey";

const CONTENDED_MESSAGE = "Someone else was changing this at the same time — try again.";

/**
 * Exported because the recovery differs by surface: on a form with an assignee
 * field the user picks someone else, but on Move/Copy there is no such field and
 * a retry succeeds on its own (the probe drops the assignee the second time), so
 * that caller words it itself instead of taking the message below.
 */
export function isNonMemberAssigneeError(error: { code?: string; message: string }): boolean {
  return error.code === "23503" && error.message.includes(NON_MEMBER_ASSIGNEE_CONSTRAINT);
}

/**
 * Turns a failed Supabase write into something worth showing a user.
 *
 * An RLS refusal (42501) arrives as 'new row violates row-level security
 * policy for table "…"' — the policy and table name are internal detail the
 * user can neither act on nor interpret, and reaching one from a form means
 * the caller simply lacked the role for that surface. Every other code keeps
 * its own message, which is usually the actionable one (a constraint name, a
 * bad value).
 *
 * 40P01 is mapped here rather than at any one call site because it is not
 * specific to a write: the assignee FK puts remove_member and every story write
 * in an ABBA pair Postgres resolves by aborting one of them (see
 * 20260730030000), and the loser can be any caller.
 */
export function writeErrorMessage(
  error: { code?: string; message: string },
  refusedMessage: string,
): string {
  if (error.code === "42501") return refusedMessage;
  if (error.code === "40P01") return CONTENDED_MESSAGE;
  if (isNonMemberAssigneeError(error)) return NON_MEMBER_ASSIGNEE_MESSAGE;
  return error.message;
}
