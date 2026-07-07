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

// Task 11 (Realtime Collaboration): subscribes to Postgres Changes so other
// users' edits are reflected without a manual page refresh. Both hooks debounce
// `onChange` (default 400ms) so a burst of related row changes — e.g. a drag
// reorder touching many `stories.position` values — triggers one refresh
// instead of one per row.
function useDebouncedCallback(callback: () => void, delayMs: number) {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callbackRef.current(), delayMs);
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

// Subscribes to all story changes within a project — used by the board to
// keep its panels (Current / Backlog / Icebox / Done) in sync with other
// users' moves, state transitions, and creations/deletions.
export function useProjectStoriesRealtime(projectId: string, onChange: () => void) {
  const debouncedOnChange = useDebouncedCallback(onChange, 400);

  useRealtimeChannel(`stories-project-${projectId}`, (channel) =>
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stories", filter: `project_id=eq.${projectId}` },
        debouncedOnChange,
      )
      .subscribe(),
  );
}

// Subscribes to a single story's row plus its comment thread — used by
// `StoryDetailPanel` so the inline board expansion and the standalone
// `/stories/[id]` page both pick up other users' field edits and new comments.
export function useStoryRealtime(storyId: string, onChange: () => void) {
  const debouncedOnChange = useDebouncedCallback(onChange, 400);

  useRealtimeChannel(`story-detail-${storyId}`, (channel) =>
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stories", filter: `id=eq.${storyId}` },
        debouncedOnChange,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: `story_id=eq.${storyId}` },
        debouncedOnChange,
      )
      .subscribe(),
  );
}

// Task 10 (Notifications): fires `onNotify` for the two Realtime-driven
// triggers (see spec/features.md) — assigned to a story / a story you own
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
            const notification = storyChangeNotification(null, payload.new, userId);
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
            const notification = storyChangeNotification(oldRow, payload.new, userId);
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
