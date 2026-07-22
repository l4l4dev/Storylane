---
id: TASK-149
title: Run the 10-expert /ux-review panel on My Work + triage findings
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 11:26'
updated_date: '2026-07-22 13:34'
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
- [x] #1 Panel run on the current My Work screen after TASK-148 merges; output saved as a numbered doc under reviews/
- [x] #2 Findings triaged with the owner; accepted items filed as ordered Backlog tasks, rejected items recorded with a one-line reason
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ran the 10-expert /ux-review panel (Rams, Ive, Norman, Nielsen, Wroblewski, Krug, Au, Garrett, Hall, Levey) on the My Work screen (page.tsx/layout.tsx + 4 components), each reviewing independently and blind to the others via parallel opus agents. Synthesized 46 unique deduplicated findings (High 10 / Medium 14 / Low 22) into doc-17 (reviews/), following doc-7's format. Triaged the High tier with the owner: all 10 accepted, bundled by theme into TASK-150 (free-column management: delete confirm, consolidated edit/reorder UI, always-visible grip per owner decision, order persistence), TASK-151 (row identity at narrow widths + personal/team signifier), TASK-152 (empty-state guidance copy), TASK-153 (carry-over label wording), TASK-154 (Done drag-over gating for team cards). Medium/Low (24 findings) kept in doc-17 deferred for a future batch, matching doc-7's own precedent (it also left Medium/Low un-triaged after its first pass).
<!-- SECTION:FINAL_SUMMARY:END -->
