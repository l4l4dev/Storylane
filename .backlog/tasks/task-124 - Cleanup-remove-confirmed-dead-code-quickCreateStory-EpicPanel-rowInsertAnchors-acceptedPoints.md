---
id: TASK-124
title: >-
  Cleanup: remove confirmed-dead code (quickCreateStory, EpicPanel,
  rowInsertAnchors, acceptedPoints)
status: In Progress
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 11:27'
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
- [ ] #1 quickCreateStory (apps/web/app/projects/[id]/board/actions.ts) removed along with its now-unused test coverage, superseded by createDraftStory
- [ ] #2 EpicPanel/EpicPanelData (apps/web/components/features/board/epic-panel.tsx) removed — confirmed unreferenced
- [ ] #3 rowInsertAnchors (apps/web/lib/utils/iterations.ts) removed — confirmed unreferenced
- [ ] #4 acceptedPoints (packages/core/src/velocity.ts) removed along with its test — confirmed unreferenced
- [ ] #5 pnpm test + lint green (both apps/web and packages/core)
<!-- AC:END -->
