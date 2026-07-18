---
id: TASK-83
title: Update spec/ for the concept redesign (doc-8)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:03'
labels:
  - spec
dependencies: []
references:
  - doc-8
priority: high
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite the affected spec sections to match doc-8 (all decisions AND every "(advisor)" correction — the advisor corrections are mandatory, not optional). Scope: glossary.md (drop free mode/Focus view, add My Work, working-day calendar, capacity, story pins, is-agent flag, per-project term), data-model.md (drop workflow_mode/free-board tables/stories.focus, add calendar tables, user_time_off dates+kind only, iterations.capacity, story_pins, profiles is-agent flag, cadence semantics), velocity.md (person-day rate = ratio of sums over non-skipped capacity>0 done iterations, capacity snapshot at finalization, virtual groups = rate x planned capacity, 1-day cadence working-day start_date/end_date rule, cadence change effective next created row, per-sprint override via advisory-lock RPC rejected on done), screens.md (delete Focus view section, board toggle List/Kanban, My Work screen stub, quick-add parity note), features.md (move/copy pin carry-over), rls.md (story_pins policy shape, user_time_off visibility trade-off, remove_member pin cleanup), mcp.md (is-agent flag touchpoint), and the architecture-notes file (mode/mode-coupling rows). §2 flexible states: write as fixed state enum + per-project display names + hideable delivered (and optionally rejected). Do NOT implement anything.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every doc-8 section §1-§9 is reflected in the relevant spec file, including all (advisor) corrections
- [ ] #2 No spec text still references free mode, workflow_mode, the Focus view, or stories.focus except as removal notes
- [ ] #3 spec/rls.md documents story_pins policies and the user_time_off cross-project visibility trade-off
- [ ] #4 Architecture notes updated (mode rows, focus/completed_at row, new calendar/capacity coupling)
<!-- AC:END -->
