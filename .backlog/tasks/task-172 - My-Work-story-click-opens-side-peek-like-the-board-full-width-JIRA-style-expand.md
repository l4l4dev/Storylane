---
id: TASK-172
title: >-
  My Work: story click opens side peek (like the board) + full-width JIRA-style
  expand
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 06:42'
updated_date: '2026-07-23 06:53'
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
- [ ] #1 Clicking a My Work row opens the story in a right-side peek, matching the project board's behavior; the board stays visible/interactive behind it
- [ ] #2 The peek is shareable via a ?story=<id>-style query param on the My Work URL, same as the board
- [ ] #3 StoryPeek gains an 'expand to full view' control that navigates to /stories/[id]; available from both the board's and My Work's peek
- [ ] #4 The full-page story view (/stories/[id]) is redesigned to make good use of full screen width instead of the current centered max-w-2xl column, in both light and dark themes
- [ ] #5 Existing board peek behavior (close via Escape/X, focus handling, realtime delete handling) is unaffected
<!-- AC:END -->
