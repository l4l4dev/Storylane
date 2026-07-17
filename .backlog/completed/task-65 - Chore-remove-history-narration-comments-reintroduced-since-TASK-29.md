---
id: TASK-65
title: 'Chore: remove history-narration comments reintroduced since TASK-29'
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-15 23:55'
updated_date: '2026-07-16 02:49'
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
- [x] #1 None of the six comments narrates past behavior; any surviving text states only a current constraint in present tense
- [x] #2 grep -rn 'used to' over apps/web (comments near TASK- refs) reports no history narration
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Executed by Codex (gpt-5 via codex-cli, --write) in two passes: (1) the six listed locations — four test-file comments deleted entirely (test names carry the assertion), story-peek-menu.tsx and settings/actions.ts shortened to present-tense constraints only; (2) coordinator verification found two more 'used to' comments adjacent to TASK- refs (quick-add-composer.test.tsx TASK-22, board-filters.tsx TASK-45) violating AC #2 — Codex cleaned both on a resumed thread (quick-add comment deleted; board-filters rewritten as a one-line present-tense why-not). Left untouched as out of scope: 'used to' comments with no TASK- ref nearby (kanban-board.test.tsx, story-peek-menu.test.tsx — fable-advisor context) and present-tense 'no longer'/'were dropped' constraint statements. First Codex run failed silently: read-only sandbox — Codex delegations need --write for edit tasks. Validation: grep for 'used to' within 3 lines of TASK- refs over apps/web returns nothing; full pnpm test 440 passed / 76 skipped.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-16 01:35
---
Delegated to Codex (owner-approved delegation trial, 2026-07-16). Constraint: must not touch the TASK-56 slice-2 uncommitted files (board/actions.ts, board-list-view.tsx, free-board.tsx, focus-board.tsx, kanban-columns-board.tsx, lib/utils/board.ts, database.types.ts).
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed/rewrote eight history-narration comments in apps/web (six from the review list + two more found against AC #2) per the Code Comment Policy; comment-only diff, no behavior change. Verified via grep (no 'used to' near TASK- refs) and full pnpm test (440 passed).
<!-- SECTION:FINAL_SUMMARY:END -->
