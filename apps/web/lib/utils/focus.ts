// Pure, framework-free helpers for the Focus view (tracker mode only — see
// spec/screens.md "Focus view"). Dates here follow the same "YYYY-MM-DD"
// plain-string convention as lib/utils/iterations.ts, to avoid
// local-timezone drift in tests — callers convert a story's `completed_at`
// timestamp to the viewer's local calendar date before calling
// `groupDoneStories`, this module never touches `Date`/`Intl` itself.

import type { StateCategory } from "@storylane/core";

export const FOCUS_COLUMNS = ["todo", "today", "in_progress", "done"] as const;
export type FocusColumnId = (typeof FOCUS_COLUMNS)[number];

// The two columns a card can actually be dragged into — In progress and
// Done are state-driven and read-only (spec/screens.md: "In progress and
// Done columns are not drop targets").
export const FOCUS_DRAG_TARGETS = ["todo", "today"] as const;
export type FocusDragTarget = (typeof FOCUS_DRAG_TARGETS)[number];

export type FocusStory = {
  /** The story's state category, null for the Icebox (state_id null). */
  category: StateCategory | null;
  focus: string | null;
  iteration_id: string | null;
};

/**
 * The Focus-view column a story belongs to, or null if it doesn't belong in
 * this view at all (not in the current iteration, or Icebox/Backlog).
 * `rejected` groups into `in_progress` alongside the rest of the
 * in-progress work rather than getting its own column — it still needs the
 * Restart transition, same reasoning as Kanban view's Rejected column.
 */
export function focusColumnForStory(
  story: FocusStory,
  currentIterationId: string | null,
): FocusColumnId | null {
  if (!currentIterationId || story.iteration_id !== currentIterationId) {
    return null;
  }
  switch (story.category) {
    case "done":
      return "done";
    case "in_progress":
    case "rejected":
      return "in_progress";
    case "unstarted":
      if (story.focus === "today") {
        return "today";
      }
      return "todo";
    default:
      // null (Icebox) never belongs to the current iteration's view.
      return null;
  }
}

export type FocusDropEvaluation =
  | { ok: true; focus: string | null }
  | { ok: false; reason: string };

/**
 * Validates dragging `story` onto `to` (Todo / Today). Drag only ever sets
 * or clears `focus` and never touches state (spec/screens.md) — only
 * unstarted-category stories can be dragged here at all, since In progress
 * and Done aren't drop sources in the UI; re-checked server-side too.
 */
export function evaluateFocusDrop(story: Pick<FocusStory, "category">, to: FocusDragTarget): FocusDropEvaluation {
  if (story.category !== "unstarted") {
    return { ok: false, reason: "Only not-yet-started stories can be moved here" };
  }
  return { ok: true, focus: to === "todo" ? null : to };
}

export type DoneGroup<T> = { label: string; dateKey: string; stories: T[] };

export function todayLocalDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function localDateKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyMinusOneDay(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day) - 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Same "YYYY/M/D" shape as lib/utils/format.ts's formatDate, but reusing
// that function here would parse the date-only dateKey as UTC midnight and
// re-read it through local getters — a double conversion that can shift the
// label by a day. Plain string math instead, consistent with this module's
// no-Date policy above.
function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}/${month}/${day}`;
}

/**
 * Groups Done-column stories under "Today" / "Yesterday" / a raw date
 * header, most-recent-first (spec/screens.md "Focus view": Done "grouped
 * under date headers ... by completed_at"). `completedDateKey` is each
 * story's `completed_at`, already converted by the caller to a "YYYY-MM-DD"
 * calendar date in the viewer's local timezone; `todayKey` is today's date
 * in that same timezone — both plain strings so this function stays
 * deterministic and timezone-free for testing.
 */
export function groupDoneStories<T extends { completedDateKey: string }>(
  stories: ReadonlyArray<T>,
  todayKey: string,
): DoneGroup<T>[] {
  const yesterdayKey = dateKeyMinusOneDay(todayKey);
  const byDate = new Map<string, T[]>();
  for (const story of stories) {
    const bucket = byDate.get(story.completedDateKey) ?? [];
    bucket.push(story);
    byDate.set(story.completedDateKey, bucket);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([dateKey, groupStories]) => ({
      dateKey,
      label: dateKey === todayKey ? "Today" : dateKey === yesterdayKey ? "Yesterday" : formatDateKey(dateKey),
      stories: groupStories,
    }));
}
