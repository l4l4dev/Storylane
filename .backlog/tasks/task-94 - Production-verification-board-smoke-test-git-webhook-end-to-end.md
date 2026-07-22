---
id: TASK-94
title: 'Production verification: board smoke test + git webhook end-to-end'
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-07-18 15:10'
updated_date: '2026-07-22 05:24'
labels: []
milestone: m-1
dependencies: []
priority: high
ordinal: 1600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deferred from TASK-3 (owner decision 2026-07-19): the deploy infrastructure is complete (Vercel production at 36e4a44, all migrations pushed, OAuth sign-in working, git-webhook Edge Function deployed and reachable), but the end-to-end production verification is postponed because the app will change soon (doc-8 redesign chain). Owner performs this manually in the production browser once the upcoming changes land.

Smoke test steps: sign in to production, create a project, quick-add a story, estimate it, advance it through the transition buttons to accepted, add a comment and a checklist task, confirm the Activity feed recorded it all.

Webhook steps: in project Settings configure the Git integration (repo URL + generated webhook secret; the screen shows the payload URL of the form https://iwmacbzlfeufzedjguce.supabase.co/functions/v1/git-webhook?project=<project-id>), add a GitHub repo webhook (content type application/json, same secret, Pull requests events only), then merge a PR whose title contains [SL-<story-number>] or whose branch is storylane/<story-number> and confirm the story transitions to finished. Recent Deliveries response codes are the first diagnostic if not (200 matched:0 = reference format, 401 = secret mismatch).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Production board flow works end to end (project -> story -> estimate -> accepted, comment, task, activity feed)
- [ ] #2 A real merged PR referencing a story transitions that story to finished in production
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Absorbed deferrals (2026-07-20): before the smoke test, complete TASK-96 owner setup (DEPLOY.md 'One-time setup (owner)': 3 GitHub secrets + Vercel Deploy Hook + auto-deploy off), then push main — the first green workflow run proves TASK-96 AC#1-4. During the smoke test also confirm the settings footer shows 'v<version> (<sha>)' (TASK-95 AC#1).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-fable-5
created: 2026-07-22 05:24
---
doc-14 My Work rework shipped since this task was written (TASK-130/131/132/133 on feat/task-131-my-work-backend; TASK-137 pending) -- add to the production smoke test: (1) Project Settings 'My Work sync' mapping save as owner; (2) My Work cross-column drag on a MAPPED project actually transitions the real board state (and writes story_completions on Done); (3) unmapped project drag stays local-only; (4) mapped Doing/Done drag into a project with no active iteration surfaces the 'No active iteration' banner (also closes TASK-132 AC #4 end-to-end); (5) recategorizing a mapped state surfaces the broken-mapping banner on My Work; (6) personal-project auto-mapping (TASK-137) makes a personal task's Done land in the permanent Done log.
---
<!-- COMMENTS:END -->
