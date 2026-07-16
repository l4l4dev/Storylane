---
id: TASK-65
title: 'Chore: remove history-narration comments reintroduced since TASK-29'
status: In Progress
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-15 23:55'
updated_date: '2026-07-16 01:35'
labels:
  - web
  - chore
milestone: m-0
dependencies: []
priority: low
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Full-range code review (d023d88..HEAD, 2026-07-16) found six comments violating the repo CLAUDE.md Code Comment Policy ban on history narration ('TASK-N: ... used to ...'), the same class TASK-29 previously swept:

- apps/web/components/features/story/story-peek-menu.tsx:122
- apps/web/app/projects/[id]/settings/actions.ts:99
- apps/web/components/features/projects/project-card.test.tsx:77
- apps/web/components/features/projects/project-grid.test.tsx:68
- apps/web/components/features/board/kanban-board-toolbar.test.tsx:51
- apps/web/components/features/board/board-list-view.test.tsx:18

For each: delete the narration, keeping (rewritten in present tense) only whatever states a current non-obvious constraint. Test-file comments that only explain what the test asserts can usually go entirely — the test name should carry it. Line numbers are as of commit 64715df; re-grep for 'used to' / 'were dropped' / 'no longer' near TASK- references before editing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 None of the six comments narrates past behavior; any surviving text states only a current constraint in present tense
- [ ] #2 grep -rn 'used to' over apps/web (comments near TASK- refs) reports no history narration
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-16 01:35
---
Delegated to Codex (owner-approved delegation trial, 2026-07-16). Constraint: must not touch the TASK-56 slice-2 uncommitted files (board/actions.ts, board-list-view.tsx, free-board.tsx, focus-board.tsx, kanban-columns-board.tsx, lib/utils/board.ts, database.types.ts).
---
<!-- COMMENTS:END -->
