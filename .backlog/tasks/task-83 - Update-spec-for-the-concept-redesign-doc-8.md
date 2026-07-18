---
id: TASK-83
title: Update spec/ for the concept redesign (doc-8)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:03'
updated_date: '2026-07-18 05:55'
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
- [x] #1 Every doc-8 section §1-§9 is reflected in the relevant spec file, including all advisor corrections from both passes
- [x] #2 No spec text still references free mode, workflow_mode, the Focus view, stories.focus, or the fixed state enum except as removal/divergence notes
- [x] #3 spec/rls.md documents project_states and story_pins policies and the user_time_off cross-project visibility trade-off
- [x] #4 Architecture notes updated (mode rows, state-category coupling, calendar/capacity coupling)
- [x] #5 fable-advisor review of the resulting spec diff passes with findings triaged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. glossary.md — drop free mode/Focus/Swimlane/WIP rows; Icebox=state_id IS NULL; reframe single mode; add My Work, working-day calendar, capacity, story pin, is-agent, per-project term, project_states/categories.
2. data-model.md — drop workflow_mode, custom_statuses/swimlanes/recurring_stories, stories.custom_status_id/focus/swimlane_id/state-enum; add project_states(+integrity rules), stories.state_id composite FK (NULL=Icebox), calendar tables (project exceptions + user_time_off dates+kind), iterations.capacity, story_pins, profiles.is_agent, cadence semantics; rewrite backlog zone predicate; update position invariant.
3. velocity.md — person-day rate (ratio of sums over non-skipped capacity>0 done iters, category=done), capacity snapshot at finalize, virtual groups = rate x planned capacity, 1-day working-day start/end rule, cadence change effective next created row, per-sprint override via advisory-lock RPC rejected on done.
4. screens.md — delete Focus + Free-mode board sections, toggle=List/Kanban, columns=project_states w/ action_label + Accept/Reject pair, classic-template parity, My Work stub, quick-add parity; strip mode branching from Projects page/board.
5. features.md — drop mode-naming note, Focus/Free sections; rewrite 'arbitrary state jumps' as deliberate divergence; estimation gate in category terms; move/copy pin carry-over; Icebox=NULL.
6. rls.md — project_states + story_pins policies, user_time_off visibility trade-off, remove_member pin cleanup; replace custom_statuses refs.
7. integrations.md — finish_story_from_git configurable target state; drop workflow_mode gate.
8. mcp.md — is-agent flag, transition tool -> set_story_state (state-id addressing); drop mode/free refs.
9. ARCHITECTURE.md — update diagram (project_states, calendar, story_pins; drop custom_statuses/swimlanes), mode/focus rows, state-category + calendar/capacity coupling.
Then AC#5: fable-advisor review of the spec diff.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rewrote spec/ + ARCHITECTURE.md to doc-8 §1-§9 (all advisor corrections). Files: glossary, data-model, velocity, screens, features, rls, integrations, mcp, ARCHITECTURE, +ux-principles (stale free-mode copy example). No code touched.
fable-advisor review of the diff (AC#5): verdict approve-with-corrections. Findings triaged and all applied:
 - [Med] rls.md: added TASK-70 board write model (a) note (set_story_state prerequisite).
 - [Low] data-model.md: added set_story_state RPC contract (SECURITY INVOKER/FOR UPDATE/done-iteration guard/auto-assign) to project_states section (was only in mcp.md).
 - [Low] screens.md: release milestone rows render in any state; virtual-group projected dates reference the fixed-cadence rule (1-day working-day boundaries); Kanban tints + quick-add + zones reworded to category terms.
 - [Low] glossary/velocity/features: 'unaccepted' -> 'not in a done-category state'.
No residual free-mode/workflow_mode/Focus/stories.focus/fixed-enum references except removal/divergence notes (grep-verified).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Transcribed the doc-8 concept redesign (§1-§9 + all advisor corrections) into spec/glossary, data-model, velocity, screens, features, rls, integrations, mcp and ARCHITECTURE.md (plus a stale free-mode copy example in ux-principles). Spec-only; no code changed. Key model shifts: single mode (free/workflow_mode removed), per-project custom project_states on fixed categories with Icebox=state_id IS NULL and any->any set_story_state, person-day velocity with capacity snapshot, working-day calendar + user_time_off, fixed-cadence sprints incl. 1-day working-day boundaries, story_pins + My Work, profiles.is_agent. Verified: grep sweep shows no residual free-mode/workflow_mode/Focus/stories.focus/fixed-enum references except removal/divergence notes; AC#3/#4 content confirmed present; fable-advisor review of the diff returned approve-with-corrections and all triaged findings were applied.
<!-- SECTION:FINAL_SUMMARY:END -->
