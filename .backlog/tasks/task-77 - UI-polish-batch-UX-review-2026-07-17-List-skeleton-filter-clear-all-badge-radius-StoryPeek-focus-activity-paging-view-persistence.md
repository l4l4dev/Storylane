---
id: TASK-77
title: >-
  UI polish batch (UX review 2026-07-17): List skeleton, filter clear-all, badge
  radius, StoryPeek focus, activity paging, view persistence
status: To Do
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-17 13:16'
updated_date: '2026-07-19 07:38'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: low
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Polish items from the fable-advisor UX review 2026-07-17, fine to land after deploy. (1) board/loading.tsx shows a 4-column kanban skeleton but the default view is List — swap to a list-shaped skeleton. (2) BoardFilters has no 'Clear all', and filtered views show unfiltered pts totals with no cue — add clear-all and consider a 'filtered' hint near the totals. (3) Badge radius language is 3-way inconsistent: hand-rolled rounded-full pills (story-card.tsx:149, story-list-row.tsx:75,80, kanban-board.tsx:148, iterations/page.tsx:100-106) vs shared Badge — unify on the shared Badge. (4) StoryPeek receives no focus on open and sits at DOM end — move focus to the panel on open (non-modal stays). (5) Activity page hard-caps at 20 with no 'load more' — add paging. (6) View selection (List/Kanban/Focus) resets to List every mount while collapse state persists — OWNER DECISION first: persist per project in localStorage, or keep resetting; implement the chosen behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the six items implemented or explicitly rejected with the owner's decision noted
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-17 15:17
---
Owner decision recorded (2026-07-18, via /ux-review High-fix approval): item 6 view persistence — persist the List/Kanban/Focus selection per project (localStorage, mirroring useCollapsedGroups). Also: the 2026-07-18 10-expert panel independently re-flagged item 2 (clear-all, 5 experts) and confirmed the filtered-empty-state hint ('No stories match the current filters.' when activeCount > 0 hides everything). Sibling task for the rest of that panel's High findings: TASK-79.
---

created: 2026-07-18 02:59
---
Concept redesign impact (doc-8 §9, 2026-07-18): the Focus view is removed and the board toggle becomes List/Kanban only. Item 6 (view persistence) applies to the two remaining views; the owner decision to persist per project in localStorage stands. Item 1 (list-shaped skeleton) unaffected.
---
<!-- COMMENTS:END -->
