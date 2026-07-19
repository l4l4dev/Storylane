// Pure, framework-free helpers for browser notifications (spec/features.md
// "Notifications"). Kept side-effect free so the triggering logic can be
// unit-tested without a Notification API or Supabase Realtime payload.

import { extractMentions } from "./comments";

export type StoryNotificationRow = {
  id: string;
  title: string;
  state_id: string | null;
  assignee_id: string | null;
};

export type NotificationContent = { title: string; body: string };

/**
 * Builds the notification for a `stories` row change, or null if it isn't
 * relevant to `userId`. Only two triggers apply here (see spec/features.md):
 * - assigned to a story: `assignee_id` newly became `userId`
 * - a story you own changes state: `userId` was already the assignee and
 *   `state_id` changed
 * `oldRow` is null for INSERTs (a brand-new story assigned to `userId` on
 * creation counts as an assignment, not a state change). `states` resolves
 * `state_id` to a display name — the realtime payload carries only the raw
 * column, no join, so the caller supplies whatever states list it already
 * has (rather than this function reaching out to Supabase itself, kept
 * side-effect free for testing). The one current caller
 * (`useNotificationsRealtime`) is mounted app-shell-wide, not scoped to a
 * project, so it has no states list to give — that degrades gracefully to
 * a generic body below rather than a misleading placeholder name.
 */
export function storyChangeNotification(
  oldRow: StoryNotificationRow | null,
  newRow: StoryNotificationRow,
  userId: string,
  states: ReadonlyArray<{ id: string; name: string }>,
): NotificationContent | null {
  if (newRow.assignee_id !== userId) {
    return null;
  }

  const wasAlreadyAssignee = oldRow?.assignee_id === userId;
  if (!wasAlreadyAssignee) {
    return { title: "Assigned to you", body: `"${newRow.title}" was assigned to you` };
  }

  if (oldRow && oldRow.state_id !== newRow.state_id) {
    const stateName = newRow.state_id === null ? "Icebox" : states.find((s) => s.id === newRow.state_id)?.name;
    const body = stateName ? `"${newRow.title}" is now ${stateName}` : `"${newRow.title}" was updated`;
    return { title: "Story updated", body };
  }

  return null;
}

/** Builds the notification for a new comment, or null if `username` isn't mentioned in it. */
export function mentionNotification(commentBody: string, username: string): NotificationContent | null {
  if (!extractMentions(commentBody).includes(username.toLowerCase())) {
    return null;
  }
  return { title: "You were mentioned", body: commentBody };
}
