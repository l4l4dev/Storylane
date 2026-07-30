---
id: TASK-224
title: 'Decide whether assignee changes belong in activity_logs, and record them if so'
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-30 12:11'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raised by Codex on PR #13 (TASK-221) and left unresolved there because it turns on a spec reading, not on the FK.

spec/screens.md 'Conflict & failure rules' says the activity-log trigger 'records state/assignment events'. log_story_activity (20260727140000) watches state_id and iteration_id, so 'assignment' is satisfied by the iteration assignment it already logs — but the sentence sits in a list about which autosaved fields deserve an activity row, and assignee is one of the autosaved discrete fields (spec/screens.md 'Discrete fields'). Assignee changes have never produced an activity_logs row.

TASK-221 made this more visible without changing it: the composite FK's ON DELETE SET NULL now unassigns stories when a member is removed, and its one-time backfill cleared dangling assignees. Both are silent — the only trace of the backfill is a RAISE NOTICE count in the deploy log.

First step is the owner's ruling on which reading of the spec is intended. Only extend the trigger if the answer is 'assignee'; otherwise clarify the spec wording so the question does not come back.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The owner's reading of spec/screens.md's 'state/assignment events' is recorded, and the spec wording is made unambiguous either way
- [ ] #2 If assignee changes are in scope: log_story_activity records them, including the ON DELETE SET NULL cascade from remove_member, with a test covering both the direct write and the cascade
- [ ] #3 If they are out of scope: no trigger change, and spec/rls.md or the migration notes why the cascade unassignment is deliberately unlogged
<!-- AC:END -->
