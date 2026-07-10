---
id: TASK-28
title: >-
  Fix: git-webhook ignores workflow_mode — merged PR force-finishes free-mode
  stories
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 10:37'
labels:
  - db
dependencies: []
priority: low
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-10: supabase/functions/git-webhook/index.ts force-finishes stories by number with no workflow_mode check. A free-mode project with a GitHub/Forgejo integration would get state='finished' written to stories whose state column is otherwise ignored (confusing if the project ever switches modes), and the follow-up 'pull into current iteration' write could attach an iteration to a free-mode story. spec/integrations.md says nothing about free mode, so the behavior is unspecified — NEEDS OWNER'S DECISION before implementing. Proposed default: webhook only applies to tracker-mode projects and returns an explicit 'ignored: free mode' response; alternatively map merged PRs to a done column in free mode (bigger scope).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 owner has decided the free-mode behavior and spec/integrations.md documents it
- [ ] #2 git-webhook guards on the project's workflow_mode accordingly
- [ ] #3 A test covers the free-mode-project webhook path
<!-- AC:END -->
