---
id: TASK-199
title: '/epics page: parallelize the peek story fetch with the page''s own queries'
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-26 09:03'
updated_date: '2026-07-26 09:55'
labels:
  - web
milestone: m-6
dependencies: []
ordinal: 1820
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-196's /code-review. apps/web/app/projects/[id]/epics/page.tsx awaits getStoryDetail(peekStoryId) sequentially after the page's own Promise.all, even though peekStoryId has no dependency on that fetch. getStoryDetail internally batches ~11 Supabase queries via its own Promise.all -- running it after (rather than alongside) the epics page's 4-query Promise.all serializes two independent network round-trips, roughly doubling server-render latency on any /epics?story=<id> load.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 getStoryDetail(peekStoryId) (when present) is launched together with the page's existing Promise.all rather than awaited afterward
- [x] #2 Behavior is unchanged when there is no peekStoryId
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
epics/page.tsx: folded getStoryDetail(peekStoryId) into the page's existing 4-query Promise.all (as a 5th element, Promise.resolve(null) when no peekStoryId) instead of awaiting it afterward. Added a regression test (page.test.tsx) that holds the 4 own-queries pending via a deferred promise and asserts getStoryDetail is still called (vi.waitFor) -- confirmed it fails against the pre-fix sequential code (timed out, 0 calls) and passes against the fix, by temporarily stashing the page.tsx change and rerunning.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
getStoryDetail(peekStoryId) now launches alongside the page's own 4-query Promise.all instead of after it, roughly halving server-render latency on /epics?story=<id>. AC#2 (no peekStoryId) unchanged: still Promise.resolve(null) in that slot. Verified via a new regression test proven to fail pre-fix and pass post-fix, plus the full suite (836 tests), tsc --noEmit, and eslint, all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
