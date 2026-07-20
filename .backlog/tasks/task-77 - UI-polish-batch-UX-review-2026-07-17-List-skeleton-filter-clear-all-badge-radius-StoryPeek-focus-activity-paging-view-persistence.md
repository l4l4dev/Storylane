---
id: TASK-77
title: >-
  UI polish batch (UX review 2026-07-17): List skeleton, filter clear-all, badge
  radius, StoryPeek focus, activity paging, view persistence
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-17 13:16'
updated_date: '2026-07-19 22:21'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
modified_files:
  - 'apps/web/app/projects/[id]/activity/page.tsx'
  - 'apps/web/app/projects/[id]/activity/page.test.tsx'
  - 'apps/web/app/projects/[id]/board/loading.tsx'
  - 'apps/web/app/projects/[id]/board/loading.test.tsx'
  - 'apps/web/app/projects/[id]/iterations/page.tsx'
  - apps/web/components/features/board/board-filters.tsx
  - apps/web/components/features/board/board-filters.test.tsx
  - apps/web/components/features/board/board-list-view.tsx
  - apps/web/components/features/board/kanban-board.tsx
  - apps/web/components/features/board/kanban-board-toolbar.test.tsx
  - apps/web/components/features/board/story-card.tsx
  - apps/web/components/features/board/story-card.test.tsx
  - apps/web/components/features/board/story-list-row.tsx
  - apps/web/components/features/board/story-list-row.test.tsx
  - apps/web/components/features/board/story-peek.tsx
  - apps/web/components/features/board/story-peek.test.tsx
priority: low
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Polish items from the fable-advisor UX review 2026-07-17, fine to land after deploy. (1) board/loading.tsx shows a 4-column kanban skeleton but the default view is List — swap to a list-shaped skeleton. (2) BoardFilters has no 'Clear all', and filtered views show unfiltered pts totals with no cue — add clear-all and consider a 'filtered' hint near the totals. (3) Badge radius language is 3-way inconsistent: hand-rolled rounded-full pills (story-card.tsx:149, story-list-row.tsx:75,80, kanban-board.tsx:148, iterations/page.tsx:100-106) vs shared Badge — unify on the shared Badge. (4) StoryPeek receives no focus on open and sits at DOM end — move focus to the panel on open (non-modal stays). (5) Activity page hard-caps at 20 with no 'load more' — add paging. (6) View selection (List/Kanban/Focus) resets to List every mount while collapse state persists — OWNER DECISION first: persist per project in localStorage, or keep resetting; implement the chosen behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each of the six items implemented or explicitly rejected with the owner's decision noted
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Replace the Kanban-shaped board fallback with a compact, accessible list-shaped skeleton.
2. Add filter-only Clear all that preserves unrelated query params, plus active-filter totals cues and current-view filtered-empty feedback.
3. Replace the specified hand-built status/points pills with the shared Badge while preserving semantic colors and distinct avatars/chips.
4. Focus the non-modal StoryPeek panel on open/story change and restore focus on close.
5. Add stable 20-row Activity cursor paging ordered by created_at + id with Older/Newer navigation.
6. Persist List/Kanban selection per project through a hydration-safe localStorage external store with an in-memory write-failure fallback; ignore invalid/legacy Focus values without removing Focus (TASK-89 scope).
7. Cover the six behaviors and edge cases with regression tests, then run targeted tests, the full web suite, lint, production build, UX review, and code review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented all six items. Activity uses composite cursor paging rather than offset paging so live inserts cannot shift page boundaries. View persistence uses useSyncExternalStore for hydration-safe reads and an in-memory fallback only when localStorage writes fail. Focus remains available but is not persisted because its removal belongs to TASK-89. UX panel findings were resolved; final spec/ux-principles review and code re-review reported no blocking findings. Verification: focused DOM tests 76/76 passed; full web suite 460 passed / 123 skipped; full ESLint passed; Next production build passed. Standalone tsc --noEmit still reports three pre-existing/concurrent TASK-85 nullability errors in lib/utils/project-states.integration.test.ts; Next build type-check passed. Live browser verification was not completed because the browser-control runtime failed to initialize; no fallback browser automation was used.
<!-- SECTION:NOTES:END -->

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

author: @codex-gpt-5
created: 2026-07-19 22:03
---
Tracker parity check (2026-07-20): the archived official “Working with stories” help confirms that opening/expanding story detail makes it the active editing surface, while collapsed cards consistently expose type, estimate, title, owner initials, state, and labels. TASK-77 will preserve that information model, move keyboard focus into StoryPeek on open, and only normalize the specified status/points pills; label/epic chips and circular assignee avatars remain distinct.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed all six TASK-77 polish items: list-shaped loading, safe filter clearing and filtered-state cues, shared status/points badges, StoryPeek focus management, stable Activity cursor paging, and per-project List/Kanban persistence. Added regression coverage for accessibility, cursor boundaries, current-view empty states, long custom states, and localStorage failure. Verified with 76 focused tests, the full 460-test web suite, ESLint, production build, final UX review, and code review; no blocking findings remain.
<!-- SECTION:FINAL_SUMMARY:END -->
