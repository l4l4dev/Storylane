---
id: TASK-200
title: 'Board: migrate remaining peek-open call sites to useOpenPeek'
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-26 09:04'
labels:
  - web
milestone: m-6
dependencies: []
ordinal: 1830
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-196's /code-review. The useOpenPeek hook (apps/web/components/features/board/use-open-peek.ts) claims to be the single call site for the peek URL contract (params.set('story', id) + router.push), but story-card.tsx and my-work-sections.tsx still hand-write the identical logic instead of using it. A future URL-contract change (e.g. adding a query param, switching to router.replace) has to be applied in three places; the two un-migrated call sites will regress silently since nothing ties them to the hook.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 story-card.tsx uses useOpenPeek instead of hand-writing the params.set('story', id) + router.push logic
- [ ] #2 my-work-sections.tsx uses useOpenPeek instead of hand-writing the same logic
- [ ] #3 Existing peek-open tests for both call sites still pass unchanged in behavior
<!-- AC:END -->
