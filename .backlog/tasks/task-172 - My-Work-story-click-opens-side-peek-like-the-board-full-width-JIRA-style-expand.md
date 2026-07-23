---
id: TASK-172
title: >-
  My Work: story click opens side peek (like the board) + full-width JIRA-style
  expand
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 06:42'
updated_date: '2026-07-23 08:47'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/components/features/board/story-peek.tsx
  - apps/web/components/features/board/story-peek-host.tsx
  - apps/web/components/features/my-work/my-work-row.tsx
  - 'apps/web/app/stories/[id]/page.tsx'
  - 'apps/web/app/projects/[id]/board/page.tsx'
priority: high
type: feature
ordinal: 1800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
My Work currently opens a story via a plain full-page navigation (my-work-row.tsx:79-82, Link to /stories/[id]), unlike the project board which opens the same story in a right-side peek panel (story-peek.tsx + story-peek-host.tsx, driven by ?story=<id> on the board URL) without leaving the board. Bring My Work to the same pattern: clicking a row opens the peek over the My Work board instead of navigating away.

JIRA-style escalation: add an 'expand to full view' control to the peek's header (StoryPeek in apps/web/components/features/board/story-peek.tsx) that navigates to /stories/[id] — this doesn't exist today on the board either, so it benefits both surfaces since StoryPeek is shared.

Separately, the destination full-page view is currently too cramped to serve as a real 'expanded' destination: apps/web/app/stories/[id]/page.tsx renders the same narrow column as the peek (mx-auto max-w-2xl) centered on an otherwise full-width page, wasting most of the screen (owner feedback: 'make it use the whole screen well'). This task includes reworking that page's layout to actually use the available width, not just re-center the same narrow panel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking a My Work row opens the story in a right-side peek, matching the project board's behavior; the board stays visible/interactive behind it
- [x] #2 The peek is shareable via a ?story=<id>-style query param on the My Work URL, same as the board
- [x] #3 StoryPeek gains an 'expand to full view' control that navigates to /stories/[id]; available from both the board's and My Work's peek
- [x] #4 The full-page story view (/stories/[id]) is redesigned to make good use of full screen width instead of the current centered max-w-2xl column, in both light and dark themes
- [x] #5 Existing board peek behavior (close via Escape/X, focus handling, realtime delete handling) is unaffected
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
My Work rows now open the shared board StoryPeek (?story=<id> on the current URL) instead of navigating away — my-work-row.tsx gained onOpen?, my-work-sections.tsx wires router.push exactly like story-card.tsx's openPeek, app/my-work/page.tsx fetches getStoryDetail + renders StoryPeekHost exactly like the board page. StoryPeek gained a Maximize2 'Expand to full view' link to /stories/[id] (shared, so the board's peek gets it too).

/stories/[id] AC#4: first pass (widen max-w-2xl -> max-w-4xl) was flagged by fable-advisor as not meeting 'redesigned ... full screen width' — reworked into a real two-column layout per advisor's blueprint: StoryFields gained section?: 'all'|'title'|'meta' (default 'all', every existing caller unaffected), StoryDetailPanel gained layout?: 'single'|'split' (default 'single', the peek never passes it — byte-identical to before). Split places a status+metadata sidebar at lg:col-start-2 and main content (title/description/tasks/comments/history) at lg:col-start-1, stacking sidebar-first on mobile so status/actions stay near the top. app/stories/[id]/page.tsx now max-w-5xl with layout="split"; loading.tsx skeleton mirrors the two-column shape.

Verified: full vitest suite (707 tests, incl. new my-work-row.test.tsx/story-peek.test.tsx/story-detail-panel.test.tsx cases) + tsc + eslint all clean. Live-verified via Playwright against the dev server: peek opens without navigating away and is shareable via URL, expand button reaches /stories/[id], two-column layout at 1440px and stacked at 500px, dark theme screenshot has no contrast issues. Two fable-advisor design reviews: first approved the peek wiring and flagged the width fix as insufficient; second (after the two-column rework) approved AC#4 as satisfied, with one non-blocking nitpick recorded in agent memory (project-task-172-story-full-page-width.md) — desktop keyboard Tab order hits the sidebar before the visually-first main column, since only CSS grid placement (not DOM order) moves the sidebar to column 2. Not spec-violating, left as a future polish item, not fixed in this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
My Work story clicks now open a shareable side peek (matching the board) with a JIRA-style 'expand to full view' button; the expand destination (/stories/[id]) was reworked into a real two-column layout (not just widened) after fable-advisor flagged the first attempt as not meeting AC#4. Verified with the full test suite, tsc/eslint, and live Playwright checks (desktop/mobile/dark theme).
<!-- SECTION:FINAL_SUMMARY:END -->
