---
id: TASK-30
title: DB-level read-only enforcement for archived projects (write-capable tables)
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-07-10 14:57'
updated_date: '2026-07-16 04:21'
labels:
  - web
  - db
milestone: m-2
dependencies: []
priority: low
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from TASK-8 (project archive/favorites/search/sort), flagged by rls-security-reviewer during TASK-8's pre-merge review. TASK-8 deliberately scoped archived-project read-only enforcement narrowly (explicit user decision, 2026-07-10): only the Move/Copy story RPCs re-check archived_at, plus the web UI's own display/archive-control gating. There is no DB-level lock across every write-capable table (stories, comments, tasks, iterations, custom_statuses, labels, story_labels, swimlanes, recurring_stories, etc.) — a non-owner member can currently write directly to an archived project's data via PostgREST/the REST API, bypassing the UI entirely. spec/rls.md and spec/screens.md were updated during TASK-8 to accurately describe this narrower scope rather than overstate the guarantee; this task is where the full enforcement (if ever wanted) would be implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decide (with the owner) whether full DB-level archived read-only enforcement is actually wanted, given the broad blast radius (touches most write-capable tables' RLS policies)
- [ ] #2 If yes: design reviewed by fable-advisor before implementation (large RLS surface change)
- [ ] #3 If yes: migration adds an archived_at check to every write-capable table's INSERT/UPDATE policies (or a shared helper function), reviewed by rls-security-reviewer
- [ ] #4 spec/rls.md and spec/screens.md updated back to the stronger guarantee once actually implemented
<!-- AC:END -->
