---
id: TASK-3
title: 'Task 11.5: Deploy + production webhook verification'
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 08:44'
updated_date: '2026-07-17 00:02'
labels: []
milestone: m-1
dependencies:
  - TASK-18
  - TASK-10
  - TASK-23
priority: high
ordinal: 1500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Supabase hosted migration push, Vercel deploy (root apps/web, Node 22, env vars incl. SUPABASE_SERVICE_ROLE_KEY), OAuth/site URL config, production smoke test, then real GitHub/Forgejo webhook verification for Task 12. Requires the owner's interactive auth (supabase login / vercel login) - prepare step-by-step instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Production board flow works end to end after deploy
- [ ] #2 A real merged PR transitions the referenced story to finished in production
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pre-deploy gate (owner, 2026-07-11): before executing this deploy task, the owner does a full manual UI review of the completed 2026-07-11 UX batch (TASK-32..46). Do not start deploy work until that review has happened and its findings are triaged.

Supabase free-tier inactivity notice received 2026-07-16: the hosted project (iwmacbzlfeufzedjguce) is scheduled for auto-pause due to no API activity (dev runs against local Supabase). Before starting this task, check the Supabase dashboard and unpause the project if it is paused (recoverable within 90 days of pausing; owner decided 2026-07-16 to leave it paused until deploy rather than keep-alive or upgrade).

2026-07-17 (from TASK-47/48/68 advisor verdict): after TASK-68 lifts the pnpm workspace root to the repo root, the Vercel project must set Root Directory = apps/web, rely on the repo-root pnpm-lock.yaml, keep 'Include source files outside of the Root Directory' enabled (so packages/core is bundled), and the build log should show pnpm 11 (packageManager moves to the root package.json).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @l4l4dev
created: 2026-07-09 05:06
---
Ordinal moved from 6000 to 17000 (2026-07-09, per the owner): confirmed no other To Do task lists TASK-3 as a dependency, so deploy-free work can proceed first. TASK-3 still depends on TASK-18/TASK-10/TASK-23 (all Done), so it stays ready whenever the owner wants to do the deploy.
---

created: 2026-07-09 05:10
---
Ordinal 17000 → 21000 (2026-07-09): 17000 collided with TASK-16.1 and sat before TASK-16.2–16.4, so it was not actually last. Now placed after all Web implementation tasks, matching the plan: finish all Web work → deploy → start iOS.
---

created: 2026-07-10 10:37
---
Code review 2026-07-10: add to the deploy checklist — the login page's 'Continue as dev user' button is hidden in production, but signInWithPassword with the fixed dev@storylane.local credentials is callable by anyone against the hosted Supabase URL + anon key. Ensure supabase/seed.sql is NEVER run against the hosted project (so the dev user doesn't exist there) and consider disabling the email/password provider in the hosted Supabase Auth settings.
---
<!-- COMMENTS:END -->
