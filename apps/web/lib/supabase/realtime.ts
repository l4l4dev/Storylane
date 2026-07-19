"use client";

import { useEffect, useRef } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  mentionNotification,
  storyChangeNotification,
  type NotificationContent,
  type StoryNotificationRow,
} from "@/lib/utils/notifications";

// Subscribes to Postgres Changes so other users' edits are reflected
// without a manual page refresh. Debounces `callback` (default 400ms) so a
// burst of related row changes — e.g. a drag reorder touching many
// `stories.position` values — triggers one refresh instead of one per row.
//
// Overloaded rather than a single `<T = void>` generic: a plain
// `() => void` callback must get back a plain `() => void` (not a
// `(arg: void) => void`, which the Realtime SDK's `.on("postgres_changes",
// ...)` overload resolution doesn't structurally match, silently falling
// through to an unrelated overload and breaking the caller's typecheck). A
// payload-carrying callback needs the *last* row, not just a "something
// changed" signal, which a no-arg debounce would lose.
function useDebouncedCallback(callback: () => void, delayMs: number): () => void;
function useDebouncedCallback<T>(callback: (arg: T) => void, delayMs: number): (arg: T) => void;
function useDebouncedCallback<T>(callback: (arg?: T) => void, delayMs: number) {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (arg?: T) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callbackRef.current(arg), delayMs);
  };
}

// Registers a Postgres Changes channel once the client's session is confirmed
// loaded — subscribing before then can join the channel under an
// unauthenticated Realtime connection, which RLS silently drops all rows for.
function useRealtimeChannel(topic: string, register: (channel: RealtimeChannel) => RealtimeChannel) {
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | undefined;
    let cancelled = false;

    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = register(supabase.channel(topic));
    });

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);
}

// Subscribes to all story and planning-divider changes within a project —
// used by the board to keep its views (List zones / Kanban columns) in sync
// with other users' moves, state transitions, creations/deletions, and
// backlog divider edits.
export function useProjectBoardRealtime(projectId: string, onChange: () => void) {
  const debouncedOnChange = useDebouncedCallback(onChange, 400);

  useRealtimeChannel(`board-project-${projectId}`, (channel) =>
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stories", filter: `project_id=eq.${projectId}` },
        debouncedOnChange,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "backlog_dividers", filter: `project_id=eq.${projectId}` },
        debouncedOnChange,
      )
      .subscribe(),
  );
}

// The subset of a `stories` row the detail panel's autosave cares about —
// see `apps/web/app/stories/[id]/actions.ts` "UpdateStoryFields".
export type StoryRealtimeRow = {
  title: string;
  description: string | null;
  story_type: string;
  points: number | null;
  epic_id: string | null;
  assignee_id: string | null;
};

// Subscribes to a single story's row plus its comment thread — split into
// three distinct signals for the per-field autosave lock (spec/screens.md
// "Conflict & failure rules"):
//   - `onFieldsChanged` gets the full new row on every UPDATE (including our
//     own save's echo — the caller's per-field lock makes that a no-op, see
//     StoryDetailPanel) so it can merge into whichever fields aren't locked.
//   - `onDeleted` fires on DELETE — the panel switches to its "story was
//     deleted" state instead of trying to interpret a row that no longer
//     exists.
//   - `onCommentsChanged` is a debounced "something in the thread changed,
//     refetch" signal; comments aren't field-locked, so a coarse refetch is
//     fine.
// UPDATE needs each row's own merge rather than just a "go refetch" nudge,
// so it uses a payload-preserving debounce: a rapid burst (e.g. this tab's
// own autosave saves echoing back) collapses into one merge of the latest
// row rather than replaying every intermediate one.
export function useStoryRealtime(
  storyId: string,
  onFieldsChanged: (row: StoryRealtimeRow) => void,
  onDeleted: () => void,
  onCommentsChanged: () => void,
) {
  const debouncedOnFieldsChanged = useDebouncedCallback(onFieldsChanged, 150);
  const debouncedOnCommentsChanged = useDebouncedCallback(onCommentsChanged, 400);

  useRealtimeChannel(`story-detail-${storyId}`, (channel) =>
    channel
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "stories", filter: `id=eq.${storyId}` },
        (payload: RealtimePostgresUpdatePayload<StoryRealtimeRow>) => {
          debouncedOnFieldsChanged(payload.new);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "stories", filter: `id=eq.${storyId}` },
        () => {
          onDeleted();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: `story_id=eq.${storyId}` },
        debouncedOnCommentsChanged,
      )
      .subscribe(),
  );
}

// Fires `onNotify` for the two Realtime-driven notification triggers (see
// spec/features.md) — assigned to a story / a story you own
// changes state, and mentioned in a comment. Unlike the hooks above this
// isn't debounced: each qualifying row change is its own notification, not a
// "something changed, go refetch" signal.
//
// `assignee_id=eq.${userId}` scopes the stories subscription so only rows
// relevant to this user's two triggers arrive at all; RLS further limits it
// to projects the user is a member of. The comments subscription has no
// server-side filter (Postgres Changes filters don't support text search),
// so every comment insert the user can see (per RLS) arrives and mentions
// are matched client-side against their username.
export function useNotificationsRealtime(
  userId: string | null,
  username: string | null,
  onNotify: (notification: NotificationContent) => void,
) {
  useRealtimeChannel(`notifications-${userId ?? "anon"}-${username ?? "anon"}`, (channel) => {
    if (userId) {
      channel = channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "stories", filter: `assignee_id=eq.${userId}` },
          (payload: RealtimePostgresInsertPayload<StoryNotificationRow>) => {
            // No states list: this listener is mounted app-shell-wide,
            // spanning every project the user belongs to, so there's no
            // single project's states to resolve state_id against —
            // storyChangeNotification degrades to a generic body.
            const notification = storyChangeNotification(null, payload.new, userId, []);
            if (notification) {
              onNotify(notification);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "stories", filter: `assignee_id=eq.${userId}` },
          (payload: RealtimePostgresUpdatePayload<StoryNotificationRow>) => {
            // REPLICA IDENTITY FULL (see the realtime-publication migration)
            // guarantees `old` carries the full previous row, not just the
            // primary key — the `"id" in` check only guards against a
            // misconfigured environment where that isn't the case.
            const oldRow = "id" in payload.old ? (payload.old as StoryNotificationRow) : null;
            const notification = storyChangeNotification(oldRow, payload.new, userId, []);
            if (notification) {
              onNotify(notification);
            }
          },
        );
    }

    if (username) {
      channel = channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments" },
        (payload: RealtimePostgresInsertPayload<{ body: string }>) => {
          const notification = mentionNotification(payload.new.body, username);
          if (notification) {
            onNotify(notification);
          }
        },
      );
    }

    return channel.subscribe();
  });
}
