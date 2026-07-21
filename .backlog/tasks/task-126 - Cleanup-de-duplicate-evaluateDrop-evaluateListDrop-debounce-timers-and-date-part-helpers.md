---
id: TASK-126
title: >-
  Cleanup: de-duplicate evaluateDrop/evaluateListDrop, debounce timers, and
  date-part helpers
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:01'
labels: []
dependencies: []
priority: low
type: chore
ordinal: 12300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 low-severity bundle (duplication).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 evaluateDrop/evaluateListDrop's icebox-demotion and backlog-return blocks (apps/web/lib/utils/kanban.ts) share one helper instead of two near-verbatim copies
- [ ] #2 story-detail-panel.tsx and invite-member-form.tsx's hand-rolled debounce timers share one useDebouncedCallback helper in lib/utils/
- [ ] #3 formatDate/formatDateTime (apps/web/lib/utils/format.ts) share one date-part-extraction helper
- [ ] #4 pnpm test + lint green
<!-- AC:END -->
