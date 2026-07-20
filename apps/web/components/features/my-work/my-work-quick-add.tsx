"use client";

import { useState } from "react";
import { DraftStoryCard, DraftStoryTrigger } from "@/components/features/board/draft-story-card";

// My Work's header quick-add (spec/screens.md "My Work", doc-8 §10): no
// global shortcut, just the solo personal project's own draft-story card,
// scheduled straight into its current iteration.
export function MyWorkQuickAdd({
  projectId,
  pointScale,
  epics,
  members,
  labels,
}: {
  projectId: string;
  pointScale: number[];
  epics: { id: string; name: string }[];
  members: { id: string; name: string; isAgent?: boolean }[];
  labels: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return <DraftStoryTrigger label="Add story" onClick={() => setOpen(true)} />;
  }

  return (
    <DraftStoryCard
      projectId={projectId}
      target="unstarted"
      view="list"
      beforeItemId={null}
      pointScale={pointScale}
      epics={epics}
      members={members}
      labels={labels}
      onClose={() => setOpen(false)}
    />
  );
}
