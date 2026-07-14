---
id: TASK-33
title: Rename free-mode template away from 'KanbanFlow' (existing product name)
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-11 05:16'
updated_date: '2026-07-14 14:56'
labels:
  - web
  - copy
milestone: m-0
dependencies: []
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
'KanbanFlow' is an existing product's name and must not appear in the UI (user review 2026-07-11). Occurrences: apps/web/lib/types.ts FREE_TEMPLATES, apps/web/app/dashboard/actions.ts FREE_TEMPLATE_STATUSES, apps/web/components/features/projects/inline-create-panel.tsx label, and a comment in focus-board.tsx.

New display name TBD by the owner — candidates proposed: A) 'Daily' B) 'Today Board' C) 'Standard'. The internal template key ('kanbanflow') is stored in no DB column (only used at creation time as a form value) — confirm before renaming the key; renaming the display label alone is the minimum.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The string 'KanbanFlow' no longer appears anywhere in the UI
- [x] #2 Template still seeds the same columns and creation flow works for both templates
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECIDED (owner, 2026-07-11): new template name is 'Daily'. Rename the UI label to 'Daily'; internal key rename ('kanbanflow' → 'daily') is safe only if no DB column stores the key — verify (it is only a creation-time form value per investigation) and rename the key too if confirmed.

Follow spec/ux-principles.md (landed with TASK-46) — its design-language section codifies the no-third-party-product-names rule this task fixes.
<!-- SECTION:NOTES:END -->
