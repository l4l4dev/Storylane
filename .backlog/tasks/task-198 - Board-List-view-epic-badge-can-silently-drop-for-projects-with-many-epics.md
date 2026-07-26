---
id: TASK-198
title: 'Board: List view epic badge can silently drop for projects with many epics'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 09:03'
updated_date: '2026-07-26 09:44'
labels:
  - web
milestone: m-6
dependencies: []
ordinal: 1810
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-196's /code-review. story-list-row.tsx derives hasEpic from parentId !== null && parentEpicTitle !== null instead of trusting parentId alone -- this masks a real asymmetry between the two feeding queries in board/page.tsx: the containerRows query has no .range()/pagination while the stories query does (fetchAllRows). In a project with more epics than PostgREST's default row cap, containerById silently drops epics beyond the cap, parentEpicTitle comes back undefined for real children, and hasEpic goes false with no error -- the story quietly loses its epic badge instead of surfacing the data-fetch bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 board/page.tsx's containerRows query is paginated the same way the stories query is (fetchAllRows or equivalent), so it can't silently truncate in a project with many epics
- [x] #2 A test (or reproduction) confirms a story's epic badge survives when the project has more epics than the default page cap
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
board/page.tsx's containerRows query now goes through fetchAllRows (lib/utils/supabase-pagination.ts) instead of a single unbounded select, exactly mirroring the sibling stories query's own TASK-166 fix in the same Promise.all. Simplified two now-dead 'containerRows ?? []' guards (fetchAllRows never returns null). AC#2 evidence: fetchAllRows itself is already generically proven to page correctly past 1000 rows (lib/utils/supabase-pagination.test.ts, written for TASK-166's identical bug on the stories query) -- no page-level reproduction test added, following that same precedent rather than building new mock-Supabase infrastructure for board/page.tsx (none exists for its data-fetching path; the one existing page.test.tsx only covers the earlier project-read failure case).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
board/page.tsx's containerRows query paginated via fetchAllRows, closing the silent-truncation gap that could drop epics (and their children's epic badges) past PostgREST's 1000-row cap. Verified via vitest (835 tests, full suite; fetchAllRows's own pagination correctness already covered by supabase-pagination.test.ts), tsc --noEmit, eslint, all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
