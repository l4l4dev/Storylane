---
id: TASK-118
title: Project-creation DB failure throws uncaught instead of showing inline error
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #10. apps/web/components/features/projects/inline-create-panel.tsx:29 (handleCreate) awaits createProject with no try/catch; createProject (apps/web/app/dashboard/actions.ts) throws on a DB error instead of returning a value like every sibling action in this directory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 createProject's DB-error path is caught in inline-create-panel.tsx and shown as an inline error, matching the return-value-not-throw pattern used by sibling actions in this directory
- [ ] #2 A test proves a failed creation shows an inline error instead of propagating an uncaught exception
- [ ] #3 pnpm test + lint green
<!-- AC:END -->
