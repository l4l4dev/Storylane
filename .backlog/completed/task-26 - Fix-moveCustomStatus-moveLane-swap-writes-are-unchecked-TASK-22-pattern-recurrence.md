---
id: TASK-26
title: >-
  Fix: moveCustomStatus/moveLane swap writes are unchecked (TASK-22 pattern
  recurrence)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 10:37'
updated_date: '2026-07-10 23:51'
labels:
  - web
milestone: m-2
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
- [x] #1 assertAllSucceeded is extracted to a shared lib module (e.g. lib/supabase/assert.ts) and board/actions.ts reuses it
- [x] #2 moveCustomStatus and moveLane check both swap update results and throw on failure
- [x] #3 The swap updates also filter by project_id, matching house style
- [x] #4 upsertIterationGoal rejects non-positive/non-integer iteration numbers before writing
- [x] #5 Tests cover a failed swap surfacing an error and the goal-number validation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
assertAllSucceeded を lib/supabase/assert.ts に抽出し board/actions.ts はそれを再利用(直接テスト lib/supabase/assert.test.ts 追加)。settings/actions.ts の moveCustomStatus/moveLane はスワップ2件を assertAllSucceeded でチェックし project_id フィルタも追加(app/projects/[id]/settings/actions.test.ts 追加、失敗スワップがエラーを伝播することと project_id フィルタを確認)。upsertIterationGoal は Number.isInteger && > 0 の検証を書き込み前に追加(app/projects/[id]/board/actions.test.ts 追加、0/-1/1.5/abc/空文字を拒否、正の整数は成功することを確認)。TDD で実装(各テストの RED を確認してから実装)。pnpm test 342 passed / pnpm build 成功。
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-10 23:39
---
Reorder 2026-07-11: moved ahead of TASK-17 — Medium-priority correctness fix (silent write failures) outranks Low-priority UI polish.
---
<!-- COMMENTS:END -->
