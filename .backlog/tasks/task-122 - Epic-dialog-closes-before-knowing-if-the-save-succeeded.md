---
id: TASK-122
title: Epic dialog closes before knowing if the save succeeded
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #14. apps/web/components/features/epics/epic-form-dialog.tsx:46 has onSubmit={() => setOpen(false)} firing synchronously before the server action resolves; createEpic/updateEpic return early with no error signal on an empty/whitespace-only name, so submitting one closes the dialog as if it succeeded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 epic-form-dialog.tsx only closes after the server action resolves successfully, not synchronously on submit
- [ ] #2 createEpic/updateEpic reject (or return a visible error for) an empty/whitespace-only name instead of silently no-op'ing
- [ ] #3 A test proves submitting a whitespace-only name shows an inline error and keeps the dialog open
- [ ] #4 pnpm test + lint green
<!-- AC:END -->
