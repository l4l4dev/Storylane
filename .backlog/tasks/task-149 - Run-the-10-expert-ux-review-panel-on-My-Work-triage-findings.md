---
id: TASK-149
title: Run the 10-expert /ux-review panel on My Work + triage findings
status: To Do
assignee:
  - '@claude-fable-5'
created_date: '2026-07-22 11:26'
labels: []
dependencies:
  - TASK-148
priority: medium
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Usability-verification lane 3 (owner-approved 2026-07-22). Once the My Work UX batch (TASK-144/145/147/148) has landed, run the 10-expert /ux-review panel on the My Work screen (precedent: doc-7 for the board screen), covering: 4-column board + free columns, Today planning flow (carry-over prompt, reordering), quick-add, Done log rendering, empty states, and the personal/team split's discoverability. Record the panel output as a numbered doc under reviews/ per the doc-hygiene rules, then triage findings WITH the owner into Backlog tasks (do not fix inline). If Fable is unavailable, run on @claude-opus-4-8 per the model policy. Complement, not replacement: per-task fable-advisor reviews check principle violations; this panel judges whether the whole screen is actually pleasant to use. The owner's [friction] dogfooding log (doc-16) feeds the same triage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Panel run on the current My Work screen after TASK-148 merges; output saved as a numbered doc under reviews/
- [ ] #2 Findings triaged with the owner; accepted items filed as ordered Backlog tasks, rejected items recorded with a one-line reason
<!-- AC:END -->
