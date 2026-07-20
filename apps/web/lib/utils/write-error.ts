/**
 * Turns a failed Supabase write into something worth showing a user.
 *
 * An RLS refusal (42501) arrives as 'new row violates row-level security
 * policy for table "…"' — the policy and table name are internal detail the
 * user can neither act on nor interpret, and reaching one from a form means
 * the caller simply lacked the role for that surface. Every other code keeps
 * its own message, which is usually the actionable one (a constraint name, a
 * bad value).
 */
export function writeErrorMessage(
  error: { code?: string; message: string },
  refusedMessage: string,
): string {
  return error.code === "42501" ? refusedMessage : error.message;
}
