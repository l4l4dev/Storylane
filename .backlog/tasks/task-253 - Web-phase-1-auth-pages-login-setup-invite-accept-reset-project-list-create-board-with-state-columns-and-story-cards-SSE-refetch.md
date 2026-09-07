---
id: TASK-253
title: >-
  Web phase 1: auth pages (login, setup, invite accept, reset), project
  list/create, board with state columns and story cards, SSE refetch
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
updated_date: '2026-09-07 15:39'
labels: []
milestone: m-9
dependencies:
  - TASK-248
  - TASK-250
  - TASK-251
  - TASK-252
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - spec/ux-principles.md
  - spec/screens.md
priority: high
type: feature
ordinal: 900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SPA screens for the vertical slice on top of the phase-1 API: login/logout, /setup, invite accept, reset; project list + create; board page with state columns, story cards (title, number, estimate), quick-add, drag to reorder/move between columns (dnd-kit), transition controls per spec/screens.md 'Board layout' basics; SSE-driven refetch. Follow spec/ux-principles.md (check original Pivotal Tracker behaviour for tracker interactions) and end with the fable-advisor design review per CLAUDE.md. Reuse shadcn/Tailwind tokens from v0-supabase where they fit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new user can: open /setup, create the admin, create a project, add stories, drag a story to another column and see completed_at behaviour, in the browser against a local server
- [ ] #2 Component tests for the board reducer/ordering logic and the auth forms; vitest green; lint green
- [ ] #3 fable-advisor design review verdict recorded in notes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/phase-1: 2efe9da + 7570f17 (wouter shell, apiFetch/ApiError, SessionProvider with 409-derived setupRequired, login/setup/invite/reset pages, catch-all + session refresh after reset, page tests) and 8799203 + bde7d20 + 584224b (projects list/create, board with Icebox + state columns, dnd-kit drag posting the target column's orderedIds, optimistic moves released only after a successful reload with a failure fallback, point-scale estimate buttons shown in place of Start for unestimated features, quick-add as an overlay panel on the Icebox and first-unstarted headers, hidden empty rejected column, signed-in header with sign-out, SSE refetch, setup/install copy). fable-advisor design review 2026-09-08: approve with fixes; all phase-1 musts fixed. Icebox column kept for phase 1 (no list view yet) — remove when the list view arrives. Deferred (advisor 'later' + review minors): card visuals per spec/screens.md (type icons, done tint, point dots, category tint); quick-add Esc/outside-click discard, Save label, new stories land at the top (server position too); viewer sees Start/quick-add (403 on click); error text near the card; card stateId stale during the optimistic window; no feedback when an earlier move's POST fails after being superseded; overlay clipping on an empty column unchecked. web tests 54.
<!-- SECTION:NOTES:END -->
