---
id: TASK-231
title: Three deferred polish items from TASK-217's reviews
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-05 03:22'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/app/dashboard/page.tsx
  - apps/web/app/my-work/archive/page.tsx
  - apps/web/components/features/story/split-studio.tsx
  - apps/web/components/features/projects/state-manager.tsx
priority: low
ordinal: 5100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three unrelated-but-small items that TASK-217's review rounds surfaced and deliberately left out of scope. Grouped because each is a few lines and none blocks anything; split them out if one turns out to need real design work.

1. READS THAT DISCARD THEIR ERROR (found by /code-review, 2026-08-04)

`assertReadOk` (apps/web/lib/supabase/assert.ts) exists so a failed Supabase read reaches error.tsx instead of rendering as empty content. Two pages still destructure `const { data } = await ...` and drop the error:
  - apps/web/app/dashboard/page.tsx:32 — the projects list
  - apps/web/app/my-work/archive/page.tsx:26, 32, 37 — profile row, projects, project_states

Both degrade to an empty list rather than a wrong 404, which is why they were not fixed alongside the two that mattered: the activity feed (whose discarded error hid an ambiguous PostgREST embed for weeks, so it rendered 'No activity yet.' on every live load) and getStoryDetail (whose `.single()` + discarded error reported a failed read as a deleted story). Those two are fixed; these four call sites are the remainder.

Note the helper's own rule when fixing: an existence check must use `.maybeSingle()`, not `.single()`, or a legitimate RLS-filtered zero rows becomes a thrown error. archive/page.tsx:27 currently uses `.single()`.

2. SPLIT STUDIO'S HINT SHIFTS THE LAYOUT (found by fable-advisor, 2026-08-04)

apps/web/components/features/story/split-studio.tsx:160-162 renders 'Select text above to extract it as a new story.' only while nothing is selected, so it appears and disappears as the user selects text — pushing the Tasks section below it up and down. spec/ux-principles.md #3 wants the space reserved instead (min-h on the container, or visibility rather than conditional rendering). Pre-existing; not introduced by the selection-clipping fix that prompted the review.

3. ICON-XS TOUCH TARGETS (found by fable-advisor, 2026-08-04)

The `icon-xs` buttons in apps/web/components/features/projects/state-manager.tsx — the reorder chevrons (2 per state row) and the delete X — are below a comfortable touch size. Raised during the 375px responsive review, where those rows now wrap onto two lines on a phone, so they are genuinely touched there. spec/ux-principles.md #7 covers touch sizing. Check whether other `icon-xs` sites share the problem before changing the variant itself: a blanket change to the Button variant would affect every icon-xs in the app, which may not be wanted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The four reads in dashboard/page.tsx and my-work/archive/page.tsx go through assertReadOk, with the existence check switched to maybeSingle so an RLS-filtered zero rows still renders as empty rather than throwing
- [ ] #2 A test covers that a failed read on one of those pages surfaces rather than rendering as empty content
- [ ] #3 Split Studio's selection hint no longer moves the Tasks section when the selection changes
- [ ] #4 The state-manager reorder and delete controls meet the touch-target size in spec/ux-principles.md #7 at 375px, and the decision on whether to change the icon-xs variant globally or only these sites is recorded
<!-- AC:END -->
