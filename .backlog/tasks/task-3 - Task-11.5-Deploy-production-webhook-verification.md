---
id: TASK-3
title: 'Task 11.5: Deploy + production webhook verification'
status: To Do
assignee: []
created_date: '2026-07-07 08:44'
updated_date: '2026-07-08 00:50'
labels: []
dependencies:
  - TASK-18
ordinal: 3000
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
