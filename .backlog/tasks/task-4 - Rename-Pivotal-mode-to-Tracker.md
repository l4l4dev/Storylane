---
id: TASK-4
title: Rename Pivotal mode to Tracker
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:24'
updated_date: '2026-07-08 07:54'
labels:
  - web
  - db
dependencies: []
references:
  - spec/features.md
  - spec/data-model.md
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The name "Pivotal Tracker" must never appear in the product UI (owner, 2026-07-07). The iteration/velocity workflow mode is now called Tracker everywhere. See spec/features.md header note and spec/data-model.md (projects.workflow_mode).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No user-facing UI string contains 'Pivotal' (mode picker, badges, app metadata description in apps/web/app/layout.tsx)
- [x] #2 Migration renames workflow_mode value 'pivotal' to 'tracker': CHECK constraint updated and existing rows updated in one migration
- [x] #3 Code identifiers and comparisons use 'tracker'; database.types.ts regenerated; tests updated and passing
- [x] #4 Spec design references to Pivotal Tracker (non-UI) are allowed and unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add migration 20260708000001 renaming workflow_mode 'pivotal'->'tracker' (update rows, replace CHECK constraint projects_workflow_mode_check, change column default).
2. Apply migration locally (supabase migration up) and regenerate apps/web/lib/database.types.ts.
3. Update UI-facing strings: layout.tsx metadata description, create-project-dialog.tsx radio value/label/state ('pivotal'->'tracker', label 'Pivotal Tracker'->'Tracker').
4. Update code identifiers: app/stories/[id]/actions.ts, app/dashboard/actions.ts, story-detail-panel.tsx, story-detail-panel.test.tsx ('pivotal'->'tracker').
5. Update e2e comment referencing old default mode name for accuracy.
6. Leave spec/comment design references to 'Pivotal Tracker' as historical context per AC4.
7. Run vitest + typecheck, verify manually, check ACs, propose commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Migration 20260708000001 renames workflow_mode 'pivotal'->'tracker' (16 existing rows migrated, CHECK constraint updated). Updated UI strings (layout.tsx metadata, create-project-dialog.tsx radio label) and code identifiers (dashboard/actions.ts, stories/[id]/actions.ts, story-detail-panel.tsx + test, e2e comment). Regenerated database.types.ts via supabase gen types. tsc, eslint, vitest (181 tests) all pass. Verified in browser: New project dialog shows 'Tracker' (no 'Pivotal'), existing tracker-mode project board/story detail work correctly post-migration. Left historical design-reference comments (e.g. story-list-row.tsx, kanban.ts) and old migration files referencing 'Pivotal Tracker' unchanged per AC4.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renamed workflow_mode 'pivotal' to 'tracker' across DB and web: new migration 20260708000001 updates the CHECK constraint and migrates existing rows; UI strings (mode picker label, app metadata) and code identifiers updated; database.types.ts regenerated. Verified with tsc, eslint, vitest (181 passing), and a manual browser check of the new-project dialog and an existing project's board/story detail.
<!-- SECTION:FINAL_SUMMARY:END -->
