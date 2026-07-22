---
id: TASK-124
title: >-
  Cleanup: remove confirmed-dead code (quickCreateStory, EpicPanel,
  rowInsertAnchors, acceptedPoints)
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 11:39'
labels: []
dependencies: []
priority: low
type: chore
ordinal: 900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 low-severity bundle (dead code). Four confirmed-unreferenced exports found during the full codebase review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 quickCreateStory (apps/web/app/projects/[id]/board/actions.ts) removed along with its now-unused test coverage, superseded by createDraftStory
- [x] #2 EpicPanel/EpicPanelData (apps/web/components/features/board/epic-panel.tsx) removed — confirmed unreferenced
- [x] #3 rowInsertAnchors (apps/web/lib/utils/iterations.ts) removed — confirmed unreferenced
- [x] #4 acceptedPoints (packages/core/src/velocity.ts) removed along with its test — confirmed unreferenced
- [x] #5 pnpm test + lint green (both apps/web and packages/core)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented via Codex (ChatGPT quota): removed 4 confirmed-dead exports after grep-verifying no remaining references (excluding own definition/test): quickCreateStory (superseded by createDraftStory; also removed its stale cross-reference comment in createBacklogDivider), EpicPanel/EpicPanelData (whole file deleted, nothing else in it was used), rowInsertAnchors (comment in nextRealRowId updated to drop the dangling reference), acceptedPoints + its PointedStory type in packages/core/src/velocity.ts (now-unused imports storyTypeUsesPoints/StateCategory removed too). Reviewed diff-by-diff: all clean, no stray references, comments updated consistently. Verified: apps/web tsc + lint clean, full suite 622/622 (69 files, 31 skipped=integration); packages/core tsc clean, suite 67/67.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed 4 confirmed-dead exports (doc-13 low-severity bundle): quickCreateStory, EpicPanel/EpicPanelData, rowInsertAnchors, acceptedPoints/PointedStory — each grep-verified unreferenced before removal, along with their now-dead tests and stray comment references. apps/web tsc+lint clean, suite 622/622; packages/core tsc clean, suite 67/67. Implemented by Codex (ChatGPT quota), diff-reviewed and verified by Claude before commit.
<!-- SECTION:FINAL_SUMMARY:END -->
