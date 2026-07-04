"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

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
