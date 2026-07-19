---
id: TASK-78
title: Convert throw-based server actions to a result-object pattern
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-17 14:08'
updated_date: '2026-07-19 06:29'
labels:
  - web
  - ux
milestone: m-2
dependencies:
  - TASK-79
modified_files:
  - apps/web/lib/types.ts
  - 'apps/web/app/projects/[id]/board/actions.ts'
  - 'apps/web/app/projects/[id]/board/actions.test.ts'
  - 'apps/web/app/stories/[id]/actions.ts'
  - 'apps/web/app/stories/[id]/actions.test.ts'
  - apps/web/components/features/story/transition-buttons.tsx
  - apps/web/components/features/story/transition-buttons.test.tsx
  - apps/web/components/features/story/task-checklist.tsx
  - apps/web/components/features/story/task-checklist.test.tsx
  - apps/web/components/features/story/comment-thread.tsx
  - apps/web/components/features/story/comment-thread.test.tsx
  - apps/web/components/features/board/quick-add-composer.tsx
  - apps/web/components/features/board/quick-add-composer.test.tsx
  - apps/web/components/features/board/board-list-view.test.tsx
priority: medium
type: enhancement
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor review of the TASK-72-75 UI batch (2026-07-17) flagged that in production, Next.js Server Actions replace a thrown Error's message with a generic message + digest -- so the try/catch pattern TASK-74 introduced (transition-buttons.tsx, task-checklist.tsx, comment-thread.tsx) only surfaces the real failure reason in dev, not prod. Users would see a generic error instead of e.g. "Story already delivered" or "Move the stories off this status before deleting it".

deleteEpic (apps/web/app/projects/[id]/epics/actions.ts, TASK-72) already avoids this: it catches internally and returns { ok: true } | { ok: false, message: string } instead of throwing, so its caller (epic-delete-menu.tsx) gets the real message regardless of environment. That's the pattern to extend.

Scope: audit apps/web/app/projects/[id]/board/actions.ts and apps/web/app/stories/[id]/actions.ts for throw-on-failure server actions whose callers already catch (transitionStory, estimateStory, addTask, toggleTask, deleteTask, addComment -- the TASK-74 set -- plus the pre-existing free-board.tsx / quick-add-composer.tsx mutations: setStatusWipLimit, createCustomStatus, updateCustomStatus, deleteCustomStatus, dropStoryFree, quickCreateStory/quickCreateStoryFree). Convert each to the result-object return shape and update its caller to check .ok instead of try/catch. deleteStory (redirects on success) is out of scope -- a redirect can't return a result object the same way; leave as-is unless a cleaner pattern is found.

Not a deploy blocker for TASK-3, but should land before it since it's exactly the failure path a first production deploy would exercise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All throw-based server actions called from TASK-74/free-board/quick-add components return a discriminated result object instead of throwing
- [x] #2 Callers check .ok and surface .message inline, matching the deleteEpic/epic-delete-menu.tsx pattern
- [x] #3 A production-mode check (or a test asserting the message survives Next.js's digest-masking behavior) confirms the real failure text still reaches the UI
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 現行の board/story Server Actions と呼び出し元を監査し、TASK-84 で削除済みの Free mode 対象を除外する。
2. 残存する失敗経路を `{ ok: true } | { ok: false; message: string }` に統一し、呼び出し元を `.ok` 判定へ変更する。
3. 実エラーメッセージが戻り値として UI まで届くことを action/component テストで検証する。
4. 対象テスト、Web 全テスト、lint を実行し、レビュー後に受入条件とタスク記録を更新する。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
現行コードを監査し、TASK-84 で削除済みの Free mode 専用 Action は対象外と確認。残存する quickCreateStory / transitionStory / estimateStory / addComment / addTask / toggleTask / deleteTask を ActionResult (`{ ok: true } | { ok: false; message }`) に変換し、QuickAddComposer / TransitionButtons / TaskChecklist / CommentThread を `.ok` 判定へ変更した。期待される DB/RPC/ゼロ件更新エラーは値で UI へ届け、予期しない request reject は固定の一般メッセージを表示して pending 状態を必ず解除する。対象テスト 6ファイル100件、tsc、eslint 成功。手動 code review: 予期しない reject 時の pending 解除漏れを1件検出して修正済み。UX 原則レビュー: principle 2 を強化、違反なし。

Final validation: targeted 7 files / 104 tests passed; full web suite 415 passed, 85 skipped; `pnpm exec tsc --noEmit` and `pnpm run lint` passed. Component tests prove `{ ok: false, message }` is rendered verbatim inline, while an actual rejected request uses only a generic fallback.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 05:57
---
Reassigned to @codex-gpt-5 (2026-07-18): precisely-scoped behavior-preserving refactor, ideal for the Codex lane (ChatGPT quota). Ordering note: board server actions (apps/web/app/projects/[id]/board/actions.ts) get rewritten by TASK-84/91 in the concept redesign — convert those last or leave them out; converting them now would be churned away.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Converted the seven remaining TASK-74/quick-add Server Actions to a shared discriminated ActionResult and updated all four callers to branch on `.ok`, preserving real DB/RPC failure text in production instead of relying on thrown Server Action errors. Added direct Action result tests plus component coverage for verbatim inline messages and unexpected-request fallback. Verified with 104 targeted tests, the full Web suite (415 passed, 85 skipped), TypeScript, and ESLint; manual code review and UX-principles review completed with the one pending-state finding fixed.
<!-- SECTION:FINAL_SUMMARY:END -->
