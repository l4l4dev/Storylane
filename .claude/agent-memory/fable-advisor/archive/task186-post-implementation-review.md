---
name: task186-post-implementation-review
description: TASK-186 (icebox accordion nested-child drag) post-implementation design review, 2026-07-24 — approve-with-fix for a same-nest reorder dead control
metadata:
  type: project
---

Reviewed the implemented diff (uncommitted on `main` at review time: `apps/web/lib/utils/kanban.ts`
+ `apps/web/components/features/board/board-list-view.tsx`), against [[task186-icebox-accordion-drag-design]]
(the pre-implementation verdict). Architecture matches what was recommended (epicIceboxZoneId
container key, isAllowedMove translation, no RPC/migration). One correction required before merge.

**Cross-zone drop-onto-nest silent revert (the question asked): acceptable, not a new violation.**
`spec/screens.md` line ~189 already documents this exact UX for the estimation gate ("a drop into
any other category is rejected and the card snaps back") with no toast — the whole board (Kanban
`isAllowedDrop`/List `isAllowedMove`) already reverts silently on any rejected cross-zone drop
site-wide, and no zone anywhere uses an `isOver` drag-over highlight, so the nest doesn't visually
over-promise relative to Current/Backlog/Icebox's own existing droppables. Don't require gating
registration of the droppable itself for this.

**Real finding: same-nest reorder is an unconditional dead control (principle 1, not 2).**
`isAllowedMove`'s new branch (`board-list-view.tsx` ~line 1348) is `if (isEpicIceboxZone(targetZone))
return false;` — this rejects BOTH (a) dragging in from outside the nest (correctly out of scope,
TASK-187) AND (b) reordering two children already inside the SAME nest relative to each other
(`activeContainer === overContainer === epic:<id>`), which is a pure position change within the
already-established "icebox" zone. Confirmed by grep: `move_story_board`
(`supabase/migrations/20260721000007_move_story_board_global_positions.sql`) never references
`parent_id`/`is_container` at all — it already treats nested children exactly like flat icebox
rows for position purposes, so intra-nest reorder needs NO new RPC, unlike TASK-187. But the diff
renders every nested child via the fully-interactive `SortableListRow` (test asserts `cursor-grab`)
inside a real `SortableContext`, which invites the single most natural gesture on a sortable list —
nudge a sibling up/down — and it can NEVER succeed, unconditionally (not gated by a business rule
the user can learn, like the estimation gate). That's the "disabled button whose reason lives only
in a tooltip" defect (principle 1) wearing dnd-kit's clothes.

**Fix (one line, no new RPC):** only reject `epic:` targets when the item isn't already a member of
that same nest:
```
if (isEpicIceboxZone(targetZone)) {
  return findContainer(containers, itemId) === targetZone;
}
```
`findContainer` is already imported/used in this file. Add a same-nest-reorder test alongside the
existing "wires... as a draggable row" test (jsdom still can't simulate the real drag, but the
`isAllowedMove`/`findContainer` logic itself is a plain unit worth covering directly, not just via
component wiring).

See [[task186-icebox-accordion-drag-design]] for the pre-implementation architecture this builds on,
and [[review-sharp-edges]] for the general position-invariant/parent_id boundary this leans on.
