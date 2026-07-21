---
id: TASK-104
title: 'Onboarding: land signed-in users on My Work + New-project entry from My Work'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 05:59'
labels:
  - web
dependencies: []
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D2 (+ advisor corrections). Signed-in users land on /my-work instead of /dashboard, and My Work gets a New-project entry that opens the existing /dashboard inline create panel. Projects list (/dashboard) stays as the dedicated index. Soft-depends on TASK-103 (My Work isPersonal already works via iteration_length===1 since TASK-93 is Done, so parallelizable). See .backlog/docs/doc-11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Post-login home is /my-work: app/page.tsx (signed-in / -> /my-work), auth/login dev-login line, and auth/callback DEFAULT fallback (?? change only) all point at /my-work; the callback's next-priority branch is left intact (deep-link next is out of scope/currently dead)
- [ ] #2 My Work has a New-project entry that navigates to /dashboard with the inline create panel opened (e.g. ?new=1), reusing the panel rather than duplicating a form
- [ ] #3 Projects list (/dashboard) unchanged as the project index; My Work <-> Projects navigation stays available in the sidebar
- [ ] #4 UI passes fable-advisor design review; pnpm test + lint green
<!-- AC:END -->
