"use client";

import { useState } from "react";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryPeek } from "./story-peek";

// Keeps the peek mounted across a server refresh that can no longer find
// the story (Task 12) — the board's own Realtime subscription
// (useProjectBoardRealtime) triggers a route refresh on *any* story change
// in the project, including a delete, which would otherwise re-run
// `getStoryDetail` server-side, get `null` back, and have the
// `{peekDetail && <StoryPeek .../>}` conditional in board/page.tsx unmount
// the whole peek before `StoryDetailPanel`'s own, story-scoped Realtime
// subscription gets a chance to show its "story was deleted" state
// (spec/screens.md "Conflict & failure rules") — silently closing instead
// of keeping the user's unsaved text visible, the opposite of what's
// required. This host is always rendered (never conditionally gated by the
// server) and remembers the last non-null detail for the currently-peeked
// id in its own state, so `StoryDetailPanel` never unmounts out from under
// an in-progress edit just because the board-level refresh raced ahead of
// the panel's own delete detection.
export function StoryPeekHost({
  peekStoryId,
  detail,
}: {
  peekStoryId?: string;
  detail: StoryDetail | null;
}) {
  const [shown, setShown] = useState<{ id: string; detail: StoryDetail } | null>(
    detail && peekStoryId ? { id: peekStoryId, detail } : null,
  );
  // Companion "last props seen" state (same adjust-during-render pattern
  // used elsewhere in this codebase, e.g. board-list-view.tsx's `synced`)
  // rather than a useEffect, since this needs to update `shown` in the same
  // render the props change, before StoryPeek/StoryDetailPanel below ever
  // sees a null detail.
  const [syncedPeekStoryId, setSyncedPeekStoryId] = useState(peekStoryId);
  const [syncedDetail, setSyncedDetail] = useState(detail);

  if (syncedPeekStoryId !== peekStoryId || syncedDetail !== detail) {
    setSyncedPeekStoryId(peekStoryId);
    setSyncedDetail(detail);
    if (!peekStoryId) {
      setShown(null);
    } else if (detail) {
      setShown({ id: peekStoryId, detail });
    }
    // else: peekStoryId is set but detail just went null — either this
    // story is gone or it's a transient refetch hiccup; either way, keep
    // showing whatever was last known for this id and let
    // StoryDetailPanel's own Realtime DELETE subscription be the authority
    // on whether it's actually deleted.
  }

  if (!peekStoryId || !shown || shown.id !== peekStoryId) {
    return null;
  }
  return <StoryPeek detail={shown.detail} />;
}
