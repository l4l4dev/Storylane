---
id: TASK-104
title: 'Onboarding: land signed-in users on My Work + New-project entry from My Work'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 05:59'
updated_date: '2026-07-21 10:07'
labels:
  - web
dependencies: []
priority: medium
ordinal: 8500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D2 (+ advisor corrections). Signed-in users land on /my-work instead of /dashboard, and My Work gets a New-project entry that opens the existing /dashboard inline create panel. Projects list (/dashboard) stays as the dedicated index. Soft-depends on TASK-103 (My Work isPersonal already works via iteration_length===1 since TASK-93 is Done, so parallelizable). See .backlog/docs/doc-11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Post-login home is /my-work: app/page.tsx (signed-in / -> /my-work), auth/login dev-login line, and auth/callback DEFAULT fallback (?? change only) all point at /my-work; the callback's next-priority branch is left intact (deep-link next is out of scope/currently dead)
- [x] #2 My Work has a New-project entry that navigates to /dashboard with the inline create panel opened (e.g. ?new=1), reusing the panel rather than duplicating a form
- [x] #3 Projects list (/dashboard) unchanged as the project index; My Work <-> Projects navigation stays available in the sidebar
- [x] #4 UI passes fable-advisor design review; pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-21 08:05
---
doc-12 (2026-07-21) supersedes this task's 'New project' button placement: it moves from my-work/page.tsx into the sidebar's Projects dropdown (TASK-109). TASK-109 removes the button this task added.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Signed-in home moved to /my-work (app/page.tsx, dev-login, auth/callback default fallback); next-priority branch in callback unchanged. My Work gets a New-project button linking to /dashboard?new=1; InlineCreatePanel gained a defaultOpen prop so the existing form pre-expands there rather than duplicating it. fable-advisor design review found a layout risk (New project sharing a flex row with the quick-add's expandable draft card could get squashed) -> fixed by giving New project a fixed spot on the h1 row and moving quick-add to its own row below. Verified: 3 inline-create-panel tests (incl. new defaultOpen case) + full web suite (524) + tsc + lint green.
<!-- SECTION:FINAL_SUMMARY:END -->
