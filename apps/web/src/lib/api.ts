export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

/**
 * Same-origin JSON only. The server's CSRF guard rejects a cookie-authenticated write that is
 * not `application/json`, so every write sets it — including ones with an empty body.
 */
export async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["content-type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    ...(method === "GET" ? {} : { body: JSON.stringify(init?.body ?? {}) }),
  });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "unexpected";
    throw new ApiError(res.status, code);
  }
  return payload as T;
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email or password is not right.",
  unauthenticated: "Please sign in again.",
  forbidden: "You do not have permission to do that.",
  not_found: "That is gone, or was never yours to see.",
  setup_required: "This instance has not been set up yet.",
  setup_token_invalid: "That setup token is wrong or has expired. Restart the container to get a new one.",
  project_archived: "This project is archived. Un-archive it to make changes.",
  estimate_required: "Estimate this story before moving it out of the Icebox or a planning column.",
  points_off_scale: "Pick a value from the project's point scale.",
  points_invalid: "That is not a valid point value.",
  state_category_immutable: "A column's category cannot change. Create a new column and move the stories.",
  state_last_of_category: "A project always needs one planning column and one done column.",
  state_in_use: "Move the stories off this column first.",
  state_id_invalid: "That column does not exist.",
  state_id_required: "Pick a column.",
  state_id_unsupported: "Stories cannot be moved to that column directly.",
  assignee_not_member: "That person is not a member of this project.",
  email_taken: "That email already has an account. Sign in instead.",
  password_too_short: "Use at least 12 characters.",
  password_too_long: "That password is too long.",
  too_many_requests: "Too many attempts. Wait a few minutes and try again.",
  title_required: "A story needs a title.",
  name_required: "A name is required.",
  name_too_long: "That name is too long.",
  invalid_body: "Some of the details entered are not valid.",
  role_invalid: "That role is not valid.",
  category_invalid: "That category is not valid.",
  story_type_invalid: "That story type is not valid.",
  description_invalid: "That description is not valid.",
  description_too_long: "That description is too long.",
  point_scale_invalid: "That point scale is not valid.",
  action_label_invalid: "That action label is not valid.",
  ordered_ids_invalid: "That ordering is not valid.",
  custom_points_required: "Enter a custom point value.",
  custom_points_invalid: "That custom point value is not valid.",
  custom_points_must_be_null: "This point scale does not take a custom value.",
  csrf_check_failed: "Your session could not be verified. Reload the page and try again.",
  too_many_streams: "Too many live connections. Close another tab and try again.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}
