---
id: TASK-62
title: Tailor Slack notification for skipped iterations
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-14 16:06'
updated_date: '2026-07-20 06:10'
labels:
  - web
  - slack
  - copy
milestone: m-0
dependencies: []
modified_files:
  - apps/web/lib/utils/slack.ts
  - apps/web/lib/utils/slack.test.ts
  - 'apps/web/app/projects/[id]/board/actions.ts'
  - 'apps/web/app/projects/[id]/board/actions.test.ts'
priority: low
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor follow-up from TASK-38: notifyFinalizeEvents (apps/web/app/projects/[id]/board/actions.ts) sends the normal iterationDoneMessage ('iteration #N done, velocity 0') even when an iteration was skipped. On Slack a skip reads as a completed-with-zero iteration. Use the 'skipped' flag now carried on the 'finalized' finalize event to send a skip-specific message (e.g. 'Iteration #N skipped') instead. Small copy/logic tweak, no schema change — the skipped flag already exists on the event (see FinalizeIterationEvent) and on iterations.skipped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A finalized event with skipped=true produces a skip-specific Slack message, not the velocity-0 done message
- [x] #2 Non-skipped finalize still sends the existing done message
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a pure skip-specific Slack formatter while preserving the existing done formatter.
2. Route finalized events with skipped=true to the skip formatter; keep non-skipped events on the existing done path.
3. Add regression tests for both event branches, then run targeted and full Web checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-86後も FinalizeIterationEvent.skipped と finalize_iteration の返却値に skipped フラグが残っていることを確認。TASK-87の表示用語対応とは独立した小変更として実装可能。

検証: Slack formatter + board action の対象テスト 41件成功。Web全体は再実行で 477件成功・152件skip、pnpm run lint成功。初回の全体テストでは無関係な comment-thread.test.tsx の非同期状態待ち1件が一時失敗したが、単独再実行6件と全体再実行はいずれも成功。差分レビューは指摘なし。
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 02:59
---
Concept redesign impact (doc-8, 2026-07-18): iteration semantics change — cadence becomes per-project and changeable (§3-4), velocity moves to points-per-person-day (§7), and 1-day projects only create iterations on working days (§4), which makes "skipped" a normal occurrence rather than an anomaly. Re-check the message copy (and whether the skipped flag survives the velocity rework) against the updated spec before implementing; this task may be absorbed into the velocity/rollover rework task.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
skipped=true の finalized イベントを「Iteration #N skipped」に分岐し、非スキップ時の既存完了メッセージを維持した。formatter単体テストと finishIteration の通知経路テストで両方を検証し、Web全体テストとlintも成功。
<!-- SECTION:FINAL_SUMMARY:END -->
