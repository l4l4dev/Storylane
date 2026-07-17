---
id: TASK-72
title: >-
  Destructive deletes need confirmation: epic Delete button, free-board column
  delete
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:15'
updated_date: '2026-07-17 14:06'
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
- [x] #1 Epic delete requires an explicit confirmation dialog; Delete is no longer a sibling of Edit in the primary row; failure renders in-dialog, not the route error boundary
- [x] #2 Free-board column delete requires confirmation naming the consequence (cards move to the first column)
- [x] #3 Tests cover confirm/cancel and the failure path for both
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Epic delete: moved into an overflow (kebab) menu next to Edit; deleteEpic action changed from a raw <form action> to a callable server action returning {ok}/{ok:false,message} (matches promoteStoryToEpic pattern), so failure renders inside the confirm dialog instead of the route error boundary. Story unlink-on-delete confirmed via ON DELETE SET NULL (architecture doc).

Free-board column delete: added an inline two-step confirm (Delete column -> Cancel/Confirm delete) inside the existing kebab panel, matching its established inline-form style rather than a nested Dialog.

Correction to the review's stated consequence: verified (DB migration 20260707000007_workflow_modes.sql + deleteCustomStatus in settings/actions.ts, no reassignment trigger exists) that a non-empty column's cards do NOT fall back to the first column on delete — the stories.custom_status_id FK has no ON DELETE clause (defaults to RESTRICT/NO ACTION), so deleteCustomStatus already fails with "Move the stories off this status before deleting it" and the column is untouched. The "falls to first column" fallback that exists in board/page.tsx:404-408 is unrelated defensive rendering for orphaned rows, unreachable via this delete path. Dialog copy was written to match actual behavior: names the card count and disables Confirm delete until the column is empty, rather than claiming a reassignment that doesn't happen.

Tests: apps/web/components/features/epics/epic-delete-menu.test.tsx (new, 5 cases: hidden-by-default, dialog copy, cancel, confirm, in-dialog failure) and apps/web/components/features/board/free-board.test.tsx (added: second-click-to-delete, cancel, non-empty-disables-confirm, inline server-error). All pass; tsc --noEmit and eslint clean on touched files.

fable-advisor design review (2026-07-17, post-implementation): approve-with-fixes overall for the TASK-72-75 batch (see TASK-74 notes for the one required fix, which was in transition-buttons.tsx, not here). For this task specifically: confirmed epic-delete-menu.tsx satisfies principle 6 (overflow+confirm) and principle 2 (pending state, in-dialog error, row disappears via revalidate on success); confirmed the "stories kept but unlinked" copy matches the epics.epic_id ON DELETE SET NULL FK.

Optional refinement applied: free-board.tsx ColumnMenu's Confirm delete button was disabled (never clickable) whenever the column had cards, which the advisor noted reads closer to principle 1's disabled-dead-control anti-pattern than the "explain in place" allowance, even though the explanation text is right above it. Changed to hide the Confirm delete button entirely when storyCount > 0, leaving only the explanation and Cancel -- matches principle 1's actual guidance ("replace the blocked action", not "show it disabled"). Test updated: "disables the confirm button for a non-empty column" -> "offers only Cancel for a non-empty column".
<!-- SECTION:NOTES:END -->
