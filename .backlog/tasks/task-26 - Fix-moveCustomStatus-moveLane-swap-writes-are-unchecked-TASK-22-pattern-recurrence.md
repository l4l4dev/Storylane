---
id: TASK-26
title: >-
  Fix: moveCustomStatus/moveLane swap writes are unchecked (TASK-22 pattern
  recurrence)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 10:37'
updated_date: '2026-07-10 23:39'
labels:
  - web
dependencies: []
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-10: settings/actions.ts moveCustomStatus (line ~290) and moveLane (line ~377) fire their two position-swap updates via a bare Promise.all without checking the returned { error } — the exact failure class TASK-22 fixed on the board actions. If one update fails or RLS filters it to zero rows, positions silently end up duplicated or the action no-ops while the UI assumes success. assertAllSucceeded currently lives private in board/actions.ts; extract it to a shared lib and reuse it. Related small hardening in the same pass: upsertIterationGoal (board/actions.ts) accepts Number(formData.get("number")) unvalidated — NaN or a negative/past number reaches the DB.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 assertAllSucceeded is extracted to a shared lib module (e.g. lib/supabase/assert.ts) and board/actions.ts reuses it
- [ ] #2 moveCustomStatus and moveLane check both swap update results and throw on failure
- [ ] #3 The swap updates also filter by project_id, matching house style
- [ ] #4 upsertIterationGoal rejects non-positive/non-integer iteration numbers before writing
- [ ] #5 Tests cover a failed swap surfacing an error and the goal-number validation
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-10 23:39
---
Reorder 2026-07-11: moved ahead of TASK-17 — Medium-priority correctness fix (silent write failures) outranks Low-priority UI polish.
---
<!-- COMMENTS:END -->
