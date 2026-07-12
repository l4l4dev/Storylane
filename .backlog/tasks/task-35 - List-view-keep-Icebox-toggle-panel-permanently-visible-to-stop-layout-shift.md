---
id: TASK-35
title: 'List view: keep Icebox toggle/panel permanently visible to stop layout shift'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:17'
updated_date: '2026-07-12 09:28'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: switching between List, Kanban and Focus makes the Icebox button appear/disappear, shifting the surrounding layout and making the view switcher hard to use. In the List view the Icebox should always be visible (button and/or section permanently rendered), so nothing jumps when changing views. Check the conditional rendering in apps/web/app/projects/[id]/board/page.tsx and board-list-view.tsx / kanban-board.tsx toolbars.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Switching List <-> Kanban <-> Focus causes no horizontal/vertical shift of the view-switcher controls
- [x] #2 Icebox is always reachable from the List view without toggling anything first
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principle 3 (conditional UI never shifts layout). End with a fable-advisor design review against that file before manual verification.

Owner chose: keep the Icebox toggle's always-mounted layout slot, hidden via invisible+aria-hidden+tabIndex=-1 outside List (not removing the toggle capability, which was the other option presented). Implemented in kanban-board.tsx: the button that previously only rendered {view === "list" && (...)} is now always mounted; className toggles invisible, aria-hidden reflects visibility, tabIndex=-1 keeps it out of the tab order when hidden. Toggle behavior/state (showIcebox) for List itself is unchanged. Added data-testid="icebox-toggle" since aria-hidden correctly makes the element unfindable by role+name once hidden (verified this is accessibility-correct AT behavior, not a bug) — tests query by testid instead. New kanban-board-toolbar.test.tsx (2 tests): button stays mounted across List/Kanban/Focus with only visibility/aria-hidden/tabIndex changing, never unmounting. Verified in browser: zoomed on the toolbar row across all 3 views — the List/Kanban/Focus switcher and the filter dropdowns never shift position; Icebox toggle still works normally when back on List. Full pnpm vitest (379 passed), tsc --noEmit, eslint clean.

fable-advisor review: 修正付き承認。ブロッキング指摘1件反映済み: aria-hidden={view !== "list"} だと表示時に aria-hidden="false" が明示出力されてしまう(ARIA仕様上非推奨、実装依存の不安定挙動)ため aria-hidden={view !== "list" || undefined} に修正、表示時は属性自体を省略。テストのアサーションも not.toHaveAttribute("aria-hidden") に更新。invisible/tabIndex=-1/data-testidの構成はそのまま維持(advisor承認)。同種の残件(FinishIterationButtonのunmount、Iceboxバッジの幅変動)はTASK-59として別途登録(オーナー承認)。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Icebox toggle button in the board toolbar previously unmounted entirely outside List view ({view === "list" && <Button>...}), shrinking the ml-auto-anchored toolbar row and shifting the view switcher + filter dropdowns on every List<->Kanban<->Focus switch. Per owner's chosen direction, the button is now always mounted (reserving its layout space) and only visually/functionally hidden (invisible class + aria-hidden + tabIndex=-1) outside List — the toggle's own show/hide behavior for List is unchanged. fable-advisor review: approved after one correction (aria-hidden={view !== "list" || undefined} instead of a bare boolean, so the attribute is omitted rather than rendering aria-hidden="false" when visible). Verified in the browser: zoomed on the toolbar across all three views — the switcher and filters never move; Icebox still toggles normally on List. New kanban-board-toolbar.test.tsx (2 tests). A related, lower-priority layout-shift spot (FinishIterationButton unmount, Icebox count badge) was filed separately as TASK-59. Full pnpm vitest (379 passed), tsc --noEmit, eslint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
