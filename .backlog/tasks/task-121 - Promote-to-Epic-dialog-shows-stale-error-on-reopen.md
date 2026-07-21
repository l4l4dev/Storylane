---
id: TASK-121
title: Promote-to-Epic dialog shows stale error on reopen
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #13. apps/web/components/features/story/story-peek-menu.tsx:144 (PromoteToEpicDialog)'s error/pending state isn't reset when reopened, unlike the sibling MoveCopyDialog which clears its error in an open-keyed effect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 PromoteToEpicDialog resets its error/pending state when reopened, matching MoveCopyDialog's open-keyed reset effect
- [ ] #2 A test proves reopening after a failed attempt shows a clean dialog, not the previous error
- [ ] #3 pnpm test + lint green
<!-- AC:END -->
