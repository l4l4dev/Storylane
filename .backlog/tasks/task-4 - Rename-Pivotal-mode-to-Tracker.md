---
id: TASK-4
title: Rename Pivotal mode to Tracker
status: To Do
assignee: []
created_date: '2026-07-07 14:24'
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
- [ ] #1 No user-facing UI string contains 'Pivotal' (mode picker, badges, app metadata description in apps/web/app/layout.tsx)
- [ ] #2 Migration renames workflow_mode value 'pivotal' to 'tracker': CHECK constraint updated and existing rows updated in one migration
- [ ] #3 Code identifiers and comparisons use 'tracker'; database.types.ts regenerated; tests updated and passing
- [ ] #4 Spec design references to Pivotal Tracker (non-UI) are allowed and unchanged
<!-- AC:END -->
