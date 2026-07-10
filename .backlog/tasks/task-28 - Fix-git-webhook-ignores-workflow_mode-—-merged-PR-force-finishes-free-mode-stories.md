---
id: TASK-28
title: >-
  Fix: git-webhook ignores workflow_mode — merged PR force-finishes free-mode
  stories
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 10:37'
updated_date: '2026-07-10 23:41'
labels:
  - db
dependencies: []
priority: low
ordinal: 16000
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

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-10 23:39
---
Reorder 2026-07-11: moved behind the ready Sonnet tasks because AC #1 (owner's free-mode decision) is still open — blocked until decided. Kept before TASK-3 so the Edge Function fix ships in the initial deploy.
---

created: 2026-07-10 23:41
---
Decision 2026-07-11 (owner): webhook applies to tracker-mode projects only; for free-mode projects return an explicit 'ignored: free mode' response and write nothing. Document this in spec/integrations.md as part of the fix (AC #1 second half). Unblocked — moved back into the Sonnet queue ahead of the comment-slimming chore TASK-29.
---
<!-- COMMENTS:END -->
