---
id: TASK-72
title: >-
  Destructive deletes need confirmation: epic Delete button, free-board column
  delete
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:15'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: high
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor UX review 2026-07-17 — the only deploy blocker. (1) epics/page.tsx:82-88: each epic card shows an always-visible destructive Delete as an immediate form action, right next to Edit, no confirmation (ux-principles principle 6: irreversible actions live outside the primary click path + confirm). One mis-click deletes the epic; a failure surfaces as the route error boundary replacing the whole view. Replace with a DeleteStoryDialog-style confirm dialog + pending state, move Delete into an overflow menu, show errors inside the dialog. (2) free-board.tsx:758-771,893: 'Delete column' in the kebab menu deletes with no confirmation and the column's cards fall back to the first column on next render — add the same confirm dialog.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Epic delete requires an explicit confirmation dialog; Delete is no longer a sibling of Edit in the primary row; failure renders in-dialog, not the route error boundary
- [ ] #2 Free-board column delete requires confirmation naming the consequence (cards move to the first column)
- [ ] #3 Tests cover confirm/cancel and the failure path for both
<!-- AC:END -->
