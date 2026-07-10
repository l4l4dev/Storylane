---
id: TASK-3
title: 'Task 11.5: Deploy + production webhook verification'
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 08:44'
updated_date: '2026-07-10 10:30'
labels: []
dependencies:
  - TASK-18
  - TASK-10
  - TASK-23
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Supabase hosted migration push, Vercel deploy (root apps/web, Node 22, env vars incl. SUPABASE_SERVICE_ROLE_KEY), OAuth/site URL config, production smoke test, then real GitHub/Forgejo webhook verification for Task 12. Requires owner's interactive auth (supabase login / vercel login) - prepare step-by-step instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Production board flow works end to end after deploy
- [ ] #2 A real merged PR transitions the referenced story to finished in production
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @l4l4dev
created: 2026-07-09 05:06
---
Ordinal moved from 6000 to 17000 (2026-07-09, per owner): confirmed no other To Do task lists TASK-3 as a dependency, so deploy-free work can proceed first. TASK-3 still depends on TASK-18/TASK-10/TASK-23 (all Done), so it stays ready whenever owner wants to do the deploy.
---

created: 2026-07-09 05:10
---
Ordinal 17000 → 21000 (2026-07-09): 17000 collided with TASK-16.1 and sat before TASK-16.2–16.4, so it was not actually last. Now placed after all Web implementation tasks, matching the plan: finish all Web work → deploy → start iOS.
---
<!-- COMMENTS:END -->
