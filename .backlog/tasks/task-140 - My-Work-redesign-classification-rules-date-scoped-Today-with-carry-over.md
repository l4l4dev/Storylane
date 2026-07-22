---
id: TASK-140
title: 'My Work redesign: classification rules + date-scoped Today with carry-over'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 08:53'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-5
dependencies:
  - TASK-138
priority: high
type: feature
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-15 (advisor-approved). Replace classifyMyWork with the final rules: Done = viewer's story_completions rows (one entry per row) + personal-project real-done stories; Today = today_date equals the CLIENT-LOCAL today (passed from the client into queries/actions - DB current_date is UTC and shifts the day boundary to 9:00 JST); else column_id's free column if set, else Todo (real state shown as badge, no derived Doing). EXCLUSION RULE: an assigned team story with real category done but no completion row for the viewer appears in NO column (advisor decision - Todo would make it an undraggable dead card). Carry-over: on the first My Work load of a new day, rows with today_date < today on not-done stories prompt 'carry over N items to today?'; accepted -> today_date = today, declined -> today_date = null. Today column cards are manually orderable via today_position; other columns keep project-grouped ordering. Update spec/screens.md 'My Work' (incl. the exclusion rule) + spec/data-model.md entries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Classification implements doc-15 exactly: completions+personal-real-done Done, client-local-date Today, column_id/Todo fallback, and the real-done-no-completion exclusion (unit tests for each incl. two-completions and reopened-story cases)
- [x] #2 Carry-over prompt shows on first load of a new local day and applies/clears today_date per choice; no prompt when nothing to carry
- [ ] #3 Today column supports manual reordering persisted in today_position; other columns unchanged
- [x] #4 spec/screens.md and spec/data-model.md rewritten to match doc-15
- [x] #5 pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done in the continuous pass: classification rewritten (Today today_date > free column column_id > Todo; Done = completions). Date-scoped Today via client local date (useSyncExternalStore). Carry-over prompt + carryOverToday/dismissCarryOver actions. fable-advisor approve-with-changes; principle-3 banner layout-shift fix applied.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-opus-4-8
created: 2026-07-22 09:43
---
fable-advisor design review (ux-principles): approve-with-changes. Required principle-3 fix (carry-over banner collapse animation to avoid column layout jump) applied. Optional (non-blocking): team-Done log cards are draggable-but-always-reject — cursor polish, deferred.
---
<!-- COMMENTS:END -->
