// Pure, framework-free helpers for epics. Kept side-effect free so they can
// be unit-tested without a Supabase client or React.

import type { StateCategory } from "@storylane/core";

export type EpicProgressStory = { category: StateCategory | null };

export type EpicProgress = { accepted: number; total: number; percent: number };

/** Accepted (done-category) vs. total story count for an epic's progress bar. */
export function epicProgress(stories: ReadonlyArray<EpicProgressStory>): EpicProgress {
  const total = stories.length;
  const accepted = stories.filter((story) => story.category === "done").length;
  const percent = total === 0 ? 0 : Math.round((accepted / total) * 100);
  return { accepted, total, percent };
}
