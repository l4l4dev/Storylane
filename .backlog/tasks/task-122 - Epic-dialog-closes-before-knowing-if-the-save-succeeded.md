---
id: TASK-122
title: Epic dialog closes before knowing if the save succeeded
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 06:15'
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
- [x] #1 epic-form-dialog.tsx only closes after the server action resolves successfully, not synchronously on submit
- [x] #2 createEpic/updateEpic reject (or return a visible error for) an empty/whitespace-only name instead of silently no-op'ing
- [x] #3 A test proves submitting a whitespace-only name shows an inline error and keeps the dialog open
- [x] #4 pnpm test + lint green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
createEpic/updateEpic now return ActionResult, rejecting an empty/whitespace-only name with a visible message instead of silently no-op'ing. epic-form-dialog.tsx intercepts submit and only closes on {ok:true}, showing an inline role=alert error and keeping the dialog open on failure (matching epic-delete-menu.tsx's established pattern). fable-advisor design review passed after one fix (missing role=alert for screen-reader parity with the sibling dialog). Verified: 5 new unit tests + hands-on in browser (whitespace-only name shows 'Name is required' and dialog stays open; valid name creates and closes correctly). tsc/lint green, full suite 601 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
