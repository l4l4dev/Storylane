---
id: TASK-126
title: >-
  Cleanup: de-duplicate evaluateDrop/evaluateListDrop, debounce timers, and
  date-part helpers
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:01'
updated_date: '2026-07-22 11:34'
labels: []
dependencies: []
priority: low
type: chore
ordinal: 1100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 low-severity bundle (duplication).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 evaluateDrop/evaluateListDrop's icebox-demotion and backlog-return blocks (apps/web/lib/utils/kanban.ts) share one helper instead of two near-verbatim copies
- [x] #2 story-detail-panel.tsx and invite-member-form.tsx's hand-rolled debounce timers share one useDebouncedCallback helper in lib/utils/
- [x] #3 formatDate/formatDateTime (apps/web/lib/utils/format.ts) share one date-part-extraction helper
- [x] #4 pnpm test + lint green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented all 3 dedup targets:
1. kanban.ts: extracted demoteToIcebox + returnToBacklog, shared by evaluateDrop/evaluateListDrop's Icebox-demotion and backlog-return branches. Confirmed evaluateListDrop's 'from === current' check on the backlog-return path was provably always-true given the reachable control flow (same-zone drops already short-circuit earlier), so dropping it in favor of the shared boolean-param helper is behavior-preserving, not a behavior change.
2. New lib/utils/use-debounced-callback.ts (useDebouncedCallback(delay) -> {trigger, cancel}, memoized so it's a stable dependency-array-safe reference) shared by invite-member-form.tsx's search debounce and story-detail-panel.tsx's 5 debounce-timer call sites (change/blur/Escape/unmount-flush).
3. format.ts: extracted dateParts() (y/m/d + the resolved Date) shared by formatDate's non-date-only path and formatDateTime.
Verified: tsc + lint clean; the 4 directly affected test files (kanban.test.ts, format.test.ts, invite-member-form.test.tsx, story-detail-panel.test.tsx) all green (57/57), proving behavior preservation including the removed redundant check. Full non-integration suite 622/622 (no DB/migration involved, so integration tests are out of scope for this change).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
De-duplicated three near-verbatim code pairs flagged in the doc-13 low-severity bundle: evaluateDrop/evaluateListDrop's Icebox-demotion and backlog-return branches now share demoteToIcebox/returnToBacklog (lib/utils/kanban.ts); story-detail-panel.tsx and invite-member-form.tsx's hand-rolled debounce timers now share a new useDebouncedCallback hook (lib/utils/use-debounced-callback.ts, memoized for stable effect-dependency use); formatDate/formatDateTime share a dateParts() extraction helper (lib/utils/format.ts). All behavior-preserving — verified by the 4 directly affected test files passing unchanged (57/57) plus the full non-integration suite (622/622); tsc + lint clean. No DB/migration involved.
<!-- SECTION:FINAL_SUMMARY:END -->
