---
id: TASK-173
title: 'My Work: allow reverting a Done story back to active'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-23 06:42'
labels: []
milestone: m-2
dependencies: []
references:
  - spec/data-model.md
  - apps/web/lib/utils/my-work.ts
  - apps/web/app/my-work/actions.ts
priority: high
type: feature
ordinal: 1900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Done in My Work is currently an append-only log by design (doc-15): story_completions rows are written by the maintain_story_completed_at trigger and there is no path back to an active column. The owner reports this doesn't match reality — a done story is sometimes rejected/reopened and needs to move back to Todo/Today.

Scope needs a decision before implementation: for personal-project stories, My Work's Todo/Done drags already write the real story state directly via the set_story_state personal-project exemption (see spec/data-model.md My Work state / set_story_state), so reverting is a same-project state change. For TEAM stories, the story's real state lives on its own project board and My Work's Done entry is only a live-joined log row of a state that happened elsewhere — reverting a team story from My Work would mean writing that story's real state from outside its board's normal drag path, which is more architecturally sensitive (cross-project-style write, RLS/membership implications). This task's implementer must resolve the personal-vs-team scope (get a fable-advisor + owner decision per CLAUDE.md's architectural-change rule) before writing code, and it's acceptable to ship personal-project revert first and scope team-story revert as a follow-up if the two turn out to need different mechanisms.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Done entry for a personal-project story can be moved back to an active column (Todo/Today/a free column) directly from My Work, and this updates the story's real state
- [ ] #2 The chosen behavior for team-story Done entries (revert supported directly, or a clear path to the story's own board to change state) is implemented and documented in the task's final summary
- [ ] #3 Reverting removes/marks the story_completions entry appropriately so it doesn't keep rendering as both live and completed after the revert
- [ ] #4 RLS/membership rules are respected for whichever write path is used (rls-security-reviewer pass if the migration/RPC surface changes)
<!-- AC:END -->
