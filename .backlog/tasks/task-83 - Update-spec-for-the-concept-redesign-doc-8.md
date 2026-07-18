---
id: TASK-83
title: Update spec/ for the concept redesign (doc-8)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:03'
updated_date: '2026-07-18 03:20'
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
Rewrite the affected spec sections to match doc-8 (all decisions AND every "(advisor)" correction from both review passes — corrections are mandatory, not optional). Scope: glossary.md (drop free mode/Focus view, add My Work, working-day calendar, capacity, story pins, is-agent flag, per-project term, project_states/categories/Icebox-as-NULL), data-model.md (drop workflow_mode/free-board tables/stories.focus/state enum, add project_states with integrity rules, stories.state_id composite FK with NULL = Icebox, rewritten backlog zone predicate, calendar tables, user_time_off dates+kind only, iterations.capacity, story_pins, profiles is-agent flag, cadence semantics), velocity.md (person-day rate = ratio of sums over non-skipped capacity>0 done iterations keyed on category=done, capacity snapshot at finalization, virtual groups = rate x planned capacity, 1-day cadence working-day start_date/end_date rule, cadence change effective next created row, per-sprint override via advisory-lock RPC rejected on done), screens.md (delete Focus view section, board toggle List/Kanban, board columns = project_states with action_label advance buttons and Accept/Reject pair, classic-template parity note, My Work screen stub, quick-add parity note), features.md (move/copy pin carry-over; REWRITE the "arbitrary state jumps are not allowed" rule as a deliberate divergence: DB any-to-any, ordering discipline in UI; estimation gate in category terms), rls.md (project_states and story_pins policy shapes, user_time_off visibility trade-off, remove_member pin cleanup), integrations.md (finish_story_from_git configurable target state), mcp.md (is-agent flag, transition tool moving to state-id addressing), and the architecture-notes file (mode rows, focus/completed_at row, new calendar/capacity and state-category coupling). Do NOT implement anything.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every doc-8 section §1-§9 is reflected in the relevant spec file, including all advisor corrections from both passes
- [ ] #2 No spec text still references free mode, workflow_mode, the Focus view, stories.focus, or the fixed state enum except as removal/divergence notes
- [ ] #3 spec/rls.md documents project_states and story_pins policies and the user_time_off cross-project visibility trade-off
- [ ] #4 Architecture notes updated (mode rows, state-category coupling, calendar/capacity coupling)
- [ ] #5 fable-advisor review of the resulting spec diff passes with findings triaged
<!-- AC:END -->
