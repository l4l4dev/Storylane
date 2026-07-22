"use client";

import { useState } from "react";
import { DraftStoryCard, DraftStoryTrigger } from "@/components/features/board/draft-story-card";

// My Work's header quick-add (spec/screens.md "My Work", doc-8 §10): no
// global shortcut, just the solo personal project's own draft-story card.
// Lands in the backlog (iteration-less, lowest unstarted) via insert_board_item
// — the personal project has no iterations, ever (doc-15 decision 7), so the
// "unstarted" path's current-iteration requirement can never be met there.
export function MyWorkQuickAdd({
  projectId,
  currentUserId,
  pointScale,
  epics,
  members,
  labels,
}: {
  projectId: string;
  // Defaults the draft card's assignee to the signed-in user — a personal
  // task otherwise defaults unassigned (Pivotal parity) and would never
  // satisfy My Work's own assignee_id = viewer query, so it'd never show up
  // anywhere the user could find it again.
  currentUserId: string;
  pointScale: number[];
  epics: { id: string; name: string }[];
  members: { id: string; name: string; isAgent?: boolean }[];
  labels: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return <DraftStoryTrigger label="Add a personal task" onClick={() => setOpen(true)} />;
  }

  return (
    <DraftStoryCard
      projectId={projectId}
      target="backlog"
      view="list"
      beforeItemId={null}
      pointScale={pointScale}
      epics={epics}
      members={members}
      labels={labels}
      defaultAssigneeId={currentUserId}
      onClose={() => setOpen(false)}
    />
  );
}
