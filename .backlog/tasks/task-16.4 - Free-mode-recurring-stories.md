---
id: TASK-16.4
title: 'Free mode: recurring stories'
status: To Do
assignee: []
created_date: '2026-07-07 14:28'
labels:
  - web
  - db
dependencies: []
references:
  - spec/data-model.md
  - spec/screens.md
parent_task_id: TASK-16
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/data-model.md recurring_stories: recurrence rules (daily / weekly+weekday / monthly+day) managed in a free-project Settings section. Generation is lazy on board access — one instance per due rule, only the most recent missed occurrence (no flooding), placed in the rule's column/lane, last_generated_on advanced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration adds recurring_stories with RLS; rls-security-reviewer has reviewed it
- [ ] #2 Settings section (free projects only) creates/edits/toggles/deletes rules with cadence fields per spec
- [ ] #3 Board access generates due instances lazily: at most one per rule regardless of missed occurrences; last_generated_on advances; day_of_month > 28 clamps to month end
- [ ] #4 Tests cover daily/weekly/monthly due calculation, the no-flooding rule, and clamping
<!-- AC:END -->
