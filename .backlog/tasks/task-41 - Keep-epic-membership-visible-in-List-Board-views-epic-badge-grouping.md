---
id: TASK-41
title: Keep epic membership visible in List/Board views (epic badge + grouping)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:19'
updated_date: '2026-07-14 08:13'
labels:
  - web
  - ux
  - feature
milestone: m-0
dependencies: []
modified_files:
  - apps/web/lib/utils/stories.ts
  - apps/web/lib/utils/stories.test.ts
  - apps/web/components/features/board/story-card.tsx
  - apps/web/components/features/board/story-card.test.tsx
  - apps/web/components/features/board/story-list-row.tsx
  - apps/web/components/features/board/story-list-row.test.tsx
  - apps/web/components/features/board/kanban-board.tsx
  - apps/web/components/features/board/board-filters.tsx
  - apps/web/components/features/board/board-filters.test.tsx
  - apps/web/components/features/board/promoted-epic-banner.tsx
  - apps/web/components/features/board/promoted-epic-banner.test.tsx
  - apps/web/components/features/board/free-board.test.tsx
  - apps/web/components/features/story/story-peek-menu.tsx
  - apps/web/components/features/story/story-peek-menu.test.tsx
  - 'apps/web/app/projects/[id]/board/page.tsx'
  - 'apps/web/app/projects/[id]/epics/page.tsx'
  - 'apps/web/app/projects/[id]/iterations/page.tsx'
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: promoting a story to an epic (TASK-13 promote_story_to_epic) removed it from List/Board and jumped to the epic screen — from the boards you can no longer see which stories belong to which epic.

Desired: List/Board views show epic membership on each story (epic name badge/chip on rows and cards, colored per epic label), plus a way to see an epic's stories from the board context — e.g. an epic filter in the toolbar and/or clicking the badge filters to that epic. The epic itself is not a story and stays off the boards; what must be visible is its member stories and their grouping. Also reconsider the post-promote navigation: staying on the board with a toast link ('View epic') may be less disorienting than the current jump.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Stories assigned to an epic display the epic's name on List rows and Kanban/Focus cards
- [x] #2 The board toolbar can filter stories by epic
- [x] #3 After promoting a story to an epic the user is not silently ejected from the board (navigation behavior decided and consistent)
- [x] #4 Tests cover badge rendering and epic filter
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principle 8 (relations stay visible; never teleport the user out of context). End with a fable-advisor design review before manual verification.

Implementation (2026-07-14):
- lib/utils/stories.ts: added epicId/epic_id to StoryFilter/FilterableStory/matchesStoryFilter/filterStories (single source of truth already used by kanban-columns-board.tsx, focus-board.tsx, board-list-view.tsx, and FreeBoardPage's server-side filterStories).
- story-card.tsx: added `epic: {id,name,color}|null` to StoryCardData; new exported EpicBadge (colored dot + name, matching the Epics panel/page's existing dot convention) rendered in StoryCard's meta row.
- story-list-row.tsx: same EpicBadge, always visible (not hidden on narrow screens like label pills) since epic membership is this task's core ask.
- kanban-board.tsx: BoardStory gained epic_id (raw id for filter matching, alongside display `epic`).
- board-filters.tsx: added a 4th "Epic" select inside the existing Filters popover (TASK-45's consolidation) rather than a 5th always-visible control.
- board/page.tsx (tracker + free mode) and iterations/page.tsx (history view): query epics(id,name,color), join onto each card, wire epicId into the filter and epics options into BoardFilters. Free mode's stories query didn't even select epic_id before this — added it.
- promoted-epic-banner.tsx (new): PromotedEpicBanner + parsePromotedEpic, following the existing InviteFailedBanner query-param-banner pattern — no new toast dependency introduced (none existed in the codebase).
- story-peek-menu.tsx: PromoteToEpicDialog.handlePromote redirects to the board with ?promoted_epic=<id>&promoted_epic_name=<title> instead of jumping to /epics. The new epic's name is always the promoted story's original title (see promote_story_to_epic RPC), so no extra fetch is needed.
- epics/page.tsx: added id={epic.id} to each epic's <li> as the banner's "View epic" anchor target.

fable-advisor review (2026-07-14) — verdict: approved with 2 must-fix, both applied:
1. EpicBadge had `shrink-0` fighting its inner `truncate`, so an epic name (== the promoted story's original title, unbounded length) could overflow the row/card instead of clipping. Fixed: removed shrink-0, added max-w-40 on the badge. Verified manually by promoting a story with a long title and a task, then checking the resulting child story's badge on both List and Kanban.
2. Promoting from the board's own side peek pushed a bare board URL, silently dropping any active Type/Assignee/Label/Epic filter — inconsistent with BoardFilters.setParam/StoryCard.openPeek's existing "preserve other params" convention and principle 8. Fixed: handlePromote now checks whether the current path is this project's board and, if so, carries forward existing searchParams (minus `story`) before adding the promoted_epic params; the standalone /stories/[id] page (which has no board search params to preserve) still gets a bare board URL. Covered by two new tests in story-peek-menu.test.tsx.

Also verified (no changes needed): filters-popover placement for Epic (correct per TASK-45's control-row-declutter rationale); redirecting to the board (not back to a referrer) from both the peek and the standalone story page (the standalone page 404s post-promote either way, so "stay put" is impossible there); no race with story-detail-panel.tsx's Realtime-driven "story was deleted" banner (same immediate-navigate-away pattern the old /epics redirect already relied on); badge placement/order on both StoryCard and StoryListRow; the epics/page.tsx `:target` CSS highlight was tried and confirmed non-functional after Next.js client-side navigation (pushState doesn't trigger :target re-evaluation) via a headless JS check, so it was removed — only the plain `id` anchor remains.

Non-blocking follow-up noted by advisor: the promoted_epic/promoted_epic_name query params persist in the URL across later filter/peek interactions (same characteristic as the existing InviteFailedBanner) rather than being stripped on the next board action — left as a future nice-to-have, not filed as a separate task given its low priority.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Epic membership is now visible on List rows and Kanban/Focus cards (colored dot+name badge, truncating cleanly for long names), filterable via a 4th 'Epic' select in the board's Filters popover, and consistent across tracker mode, free mode, and the iteration history view. Promoting a story to an epic now redirects to the board (preserving any active filters) with a confirmation banner and 'View epic' link, instead of silently jumping to /epics. fable-advisor reviewed and flagged 2 must-fix issues (badge truncation, filter-preserving navigation), both fixed and verified in-browser.
<!-- SECTION:FINAL_SUMMARY:END -->
