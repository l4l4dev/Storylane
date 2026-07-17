---
id: TASK-45
title: >-
  Iteration header cleanup: goal as text (edit on click), relocate Finish
  iteration out of center
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:20'
updated_date: '2026-07-14 03:16'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11, current iteration header (kanban-board.tsx and List view header):
1. The iteration goal saves fine but keeps looking like a text field after save — render the saved goal as plain text (with a subtle edit affordance) and switch to an input only on click; empty state shows 'Add goal…' ghost text.
2. Finish iteration sits at the horizontal center of the screen and is easy to hit by accident even with the confirm dialog — move it to the header's right edge (or into an overflow '…' menu) away from primary actions.
3. General layout: the screen is minimal but key information is cramped; give iteration number, date range, points, and goal deliberate spacing/hierarchy in the header.
Present before/after to the owner for approval before merging (design change).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Saved goal renders as text, not a live input; clicking it enters edit mode
- [x] #2 Finish iteration is no longer centered; accidental-press risk visibly reduced
- [x] #3 Header shows iteration number, dates, points, goal with clear hierarchy
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principles 5 (saved values render as values) and 6 (irreversible actions out of the primary click path). End with a fable-advisor design review before manual verification.

Implemented: (1) IterationGoalBar (kanban-board.tsx) is now click-to-edit — saved goal renders as plain text (or italic 'Add goal…' ghost text when empty) with a pencil affordance revealed on hover; clicking opens an input, Enter/blur commits and returns to text (only on success — a failed save stays in edit mode with the typed value + inline error, same as before), Esc discards and returns to text. (2) Header split into two rows: row 1 = iteration info (number/Current badge/dates/points/auto-finishes/goal) with iteration number now text-base font-semibold for hierarchy; row 2 = controls (view switcher, Icebox, filters, toolbar), with FinishIterationButton moved out of the info row and anchored to row 2's right edge via ml-auto — no longer sitting between routine info and the goal input. (3) Presented actual before/after browser screenshots to the owner per the task's explicit instruction ('present before/after for approval before merging') — approved, with one piece of owner feedback: the control row (view switcher + Icebox + 3 filter selects + Finish iteration = 8 controls) felt cluttered. Presented 3 concrete consolidation options (mockup previews); owner picked collapsing the 3 filter selects (type/assignee/label) into a single 'Filters' DropdownMenu trigger with an active-count badge (board-filters.tsx) — reduces the row from 8 to 6 visible controls. Verified in browser: selecting a value inside the Filters popover does not close it (native <select> onChange doesn't trigger Radix's outside-click dismissal). Tests: kanban-board.test.tsx's IterationGoalBar suite rewritten for click-to-edit (8 tests total in that file), new board-filters.test.tsx (5 tests: badge count, popover open/select-without-closing, URL param set/clear). Full pnpm vitest (399 passed), tsc --noEmit, eslint clean.

fable-advisor review: 修正付き承認。ブロッキング指摘2件(実コードで検証確認済み)+推奨3件を反映:

(1) [必須修正・検証済み] IterationGoalBarのcommit競合状態: disabled={isSaving}がフォーカス中の要素をdisabled化した瞬間ブラウザが自動でblurを発火させ、Enter直後のblurが2本目のcommitAndClose()を誘発 — savingRefでin-flight中の再送信をno-op化し、disabledをreadOnly+aria-busyに変更してblur誘発自体を回避。さらにcommit成功時にsetSynced(trimmed)を追加(オプティミスティック更新)したところ、既存のprop同期ガード(synced !== initialGoal)が次レンダーで即座に巻き戻す新規バグを自分のテストで発見・修正(lastInitialGoalを導入し、propが実際に変化した時だけ同期する設計に変更)。
(2) [必須修正・検証済み] BoardFiltersのDropdownMenu内nested selectでTabキーが効かない件: @radix-ui/react-menu@2.1.19のdist(index.mjs 313行)でContentのkeydownハンドラがevent.key==="Tab"を無条件preventDefaultしていることをnode_modulesで直接確認。DropdownMenuをPopover(components/ui/popover.tsx新規作成、shadcn定型)に置き換え、non-modalなのでボード側のscroll-lock/aria-hiddenも解消。ブラウザで実際にTab二回でType→Assignee→Labelと到達することを確認済み。
(3) [推奨・反映] text-view buttonにaria-label追加、エディタを閉じたらフォーカスをbuttonへ復帰(restoreFocusRef+useEffect)。
(4) [推奨・反映] Finish iterationラッパーをml-auto pl-4に(flex-wrap時の緩衝帯)。
(5) [推奨・反映] spec/screens.md "Board layout"を2行ヘッダー・click-to-edit goal・Filters統合・Finish右端配置に書き直し。IterationGoalInputとの相互参照も実態(挙動が分岐した)に修正。"Saved ✓"フラッシュのコメントも実装に合わせて修正(フラッシュは意図的に削除、テキスト復帰自体がフィードバック)。

スコープ外の指摘(IterationGoalInputも同様にclick-to-edit化すべき)はTASK-61として別途登録(オーナー承認)。

Tests: kanban-board.test.tsx +4件(競合回帰・accessible name・focus復帰2件、計12件)、board-filters.test.tsx +1件(Tab到達性、計6件)。Full pnpm vitest (404 passed), tsc --noEmit, eslint clean。ブラウザで goal編集→保存→テキスト復帰、Filtersポップオーバーのキーボード操作を再確認済み。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three board-header problems from the 2026-07-11 review: (1) the iteration goal stayed a live input after saving — now click-to-edit text (spec/ux-principles.md principle 5). (2) Finish iteration sat at the horizontal center, an easy accidental-click zone for an irreversible action — moved to the controls row's right edge (principle 6). (3) the header felt cramped — split into an info row (iteration number/dates/points/goal) and a controls row. Presented actual before/after screenshots to the owner for approval per the task's explicit requirement; the owner additionally flagged the controls row itself as cluttered (8 separate controls), so the three filter selects were consolidated into one 'Filters' popover with an active-count badge (owner-picked from 3 options). fable-advisor review caught two real bugs during implementation: a genuine double-submit race in the goal editor (disabled-during-save forced a browser blur that re-triggered the commit; fixed with an in-flight guard + readOnly instead of disabled — and fixing this surfaced a second bug my own regression test caught, where the optimistic post-save update was being immediately undone by the prop-sync guard) and a real accessibility gap where Radix's DropdownMenu unconditionally blocks Tab inside its content (verified directly against the installed package source), making the three filters unreachable by keyboard — switched to a new Popover primitive (components/ui/popover.tsx). Also added: accessible names + focus restoration for the goal button, and spec/screens.md updated to describe the new layout. A related, lower-priority inconsistency (the Backlog virtual-group goal input wasn't converted the same way) was filed separately as TASK-61. Full pnpm vitest (404 passed), tsc --noEmit, eslint clean; verified in the browser (goal edit/save/text-return cycle, Filters popover keyboard Tab reachability, no popover-closing-on-select).
<!-- SECTION:FINAL_SUMMARY:END -->
