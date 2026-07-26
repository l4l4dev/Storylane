---
id: TASK-186
title: 'Icebox accordion: allow dragging container rows and their nested children'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 13:08'
updated_date: '2026-07-24 15:13'
labels: []
milestone: m-6
dependencies:
  - TASK-184
documentation:
  - doc-18
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The List view's Icebox accordion (doc-18 §9, spec/screens.md "Container accordion") is display-only in v1: nested Icebox children of a container cannot be dragged out to Current/Backlog. Since an Icebox row has no state (state_id NULL), it also gets no TransitionButtons (computeStateGate returns "none" for a null state), so there is currently NO UI path to move a container's Icebox child onto the board except: open its detail, clear its parent via the Parent picker (making it a flat top-level Icebox row), drag it out normally, then re-parent it if desired (re-parenting does not reset the child's own state_id).

Scoped per fable-advisor review (2026-07-24) to JUST this direction — the owner's actual reported pain point. The reverse direction (dragging a Current/Backlog story back into a container's nest) is split to TASK-187 (needs new backend capability); container-row-self reordering is split to TASK-188 (independent, no shared code, not a reported pain point). Both are architecture-sensitive and assigned to @claude-opus-4-8.

Design (advisor-confirmed): parent_id is NEVER touched by this operation — only state_id/iteration_id change, exactly like any other Icebox->Current/Backlog crossing (doc-18 §9: "a child with a state stays in its own zone, unaffected — it's still counted in rollup, just not nested here"). This means the existing icebox-crossing transition path (evaluateListDrop / dropStoryInList) already has the semantics needed; the work is dnd-kit wiring, not new RPC/migration work.

Architecture note (advisor): nested children currently do NOT exist in board-list-view.tsx's dnd-kit `containers` state at all — IceboxColumn's items are built by filtering `s.parentId === null`, so nested rows are fully absent from the SortableContext/droppable system today, not just visually de-emphasized. Wire them in as their own dnd-kit container key (e.g. `epic:<containerId>`) per container, each with its own useDroppable + SortableContext (mirroring IceboxColumn's own pattern). `ListZoneId` (lib/utils/kanban.ts) stays a closed 3-value union — do NOT widen it (spec/data-model.md: "a container is off the board and never in a zone"). Instead, add a translation step in isAllowedMove (board-list-view.tsx) that maps any `epic:<id>` dnd-kit container key to the semantic zone `"icebox"` before calling evaluateListDrop/zoneForStory, so the crossing-rule gate logic itself is untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A container's nested Icebox child can be dragged out to Current or Backlog (unstarted-category crossing rule applies, same as any other Icebox row); it leaves the accordion and renders as a flat row with its epic-link badge, same as an already-scheduled child. parent_id is never modified by this operation.
- [x] #2 The reverse direction (dragging into the nest) and container-row-self reordering are explicitly out of scope here (see TASK-187, TASK-188)
- [x] #3 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch main (advisor pre-consulted on design + scope, post-implementation reviewed against ux-principles.md).

Design/scope (fable-advisor, pre-implementation): scoped down from the original 3-AC draft to JUST "drag a container's nested Icebox child out to Current/Backlog" — the owner's actual reported pain point (no other UI path exists, since an Icebox row gets no TransitionButtons either). The reverse direction (drag-in, needs a new parent_id-writing RPC) split to TASK-187; container-row-self reordering (needs its own position scope, no shared code) split to TASK-188 — both architecture-sensitive, assigned @claude-opus-4-8.

Implementation (TDD): nested children previously did not exist at all in board-list-view.tsx's dnd-kit `containers` state (IceboxColumn filtered them out entirely) — added a per-container dnd-kit key (`epicIceboxZoneId`, lib/utils/kanban.ts) holding each container's Icebox children as real ListItems, wired via useDroppable + SortableContext in EpicAccordionRow (mirroring IceboxColumn's own pattern), rendered via the existing SortableListRow/StoryListRow (no new row component). `ListZoneId` stays a closed 3-value union (unchanged) per advisor's Q1: a container is off-board and never in a semantic zone (spec/data-model.md); `zoneForStory` already reads "icebox" from the story's own state_id regardless of which dnd-kit container currently holds it, so no server/RPC change was needed for the crossing itself — confirmed by reading dropStoryInList (re-derives `from` server-side from the DB row, never trusts the client's zone).

Post-implementation fable-advisor review (against ux-principles.md) found 1 real bug (fixed) before manual verification:
- Silent revert when dropping onto a container's nest from elsewhere (TASK-187 scope, not yet supported) is fine — matches the existing estimation-gate snap-back pattern used everywhere else in this view (spec/screens.md line 189), no special-casing needed.
- (real bug, principle 1 dead control) `isAllowedMove`'s new epic-zone branch blanket-rejected BOTH crossing-in (correctly out of scope) AND same-nest sibling reordering (in scope — move_story_board already scopes Icebox position regardless of parent_id, no new RPC needed) — every nested row rendered fully draggable (cursor-grab, real SortableContext) but any drag always failed. Fixed: added `isAllowedEpicNestDrop(activeContainerId, targetZone)` (kanban.ts) so a same-container move is allowed, cross-container into an epic nest still isn't.

Found during manual browser verification (2 more fixes):
- The container's own accordion header badge (parentEpicTitle "part of Epic" link) was ALSO rendered on a still-nested child via the shared StoryListRow — redundant, and its fixed (non-shrinking) width squeezed titles down to 1-2 visible characters in the narrow 288px Icebox sidebar column (a real readability defect that would make it impossible to confidently grab the right row to drag). Fixed: added `hideEpicLink` prop to StoryListRow/SortableListRow, set only for EpicAccordionRow's nested render.
- A same-nest reorder (allowed by isAllowedEpicNestDrop) was sending the raw dnd-kit container key ("epic:<id>") to dropStoryInList as target_zone — the server action only understands the 3 canonical ListZoneId strings and silently fell through to its "current" branch for anything else, actually SCHEDULING the story instead of just reordering it within Icebox (caught live: dragging one nested sibling past another moved it out to Current instead of just reordering). Fixed: added `toServerZone(dndContainerId)` (kanban.ts) translating any epic nest key to ICEBOX_COLUMN_ID before it's sent to the server; the client-side reorder/gating logic was already correct, only the outgoing wire value was wrong.

Manual browser verification (dev server + local Supabase, fresh test project + a throwaway test epic with 3 Icebox children, cleaned up by id after): confirmed end-to-end via precise synthetic PointerEvent sequences (dnd-kit's PointerSensor did not reliably respond to the browser tool's built-in click-drag primitive for this narrow-sidebar case, even though the same primitive worked fine for TASK-183's Split Studio drag — used direct pointerdown/pointermove/pointerup dispatch instead, which dnd-kit responded to correctly) —
1. Dragging a nested child out to Current works: it leaves the accordion, shows in Current with its state + the "part of Epic" badge, rollup count updates.
2. Dropping a Current row onto a container's nest from outside is correctly rejected (silent revert, no crash, no data change) — TASK-187 scope confirmed still gated off.
3. Reordering two siblings within the same nest now works correctly (position swap persisted server-side, confirmed via fresh page reload) without leaking either one out to Current — this is the regression the toServerZone fix closed.

Verified: unit 780 pass (+8 new: kanban.test.ts epicIceboxZoneId/isEpicIceboxZone/isAllowedEpicNestDrop/toServerZone, board-list-view.test.tsx nested-drag-wiring, story-list-row.test.tsx hideEpicLink), lint clean, tsc clean.

/code-review (post-manual-verification) found 3 issues, all fixed:
1. (real bug, HIGH) isAllowedMove only special-cased drops INTO an epic nest — dragging a nested child onto the FLAT top-level Icebox list (a different, unguarded escape path) fell through to the ordinary icebox->icebox no-op check and was allowed, persisting a position change while parent_id stayed untouched; the flat list's own parentId-null filter would then re-nest it on the next refresh, making the move look like it silently reverted itself. Fixed: added isDisallowedEpicNestEscape(activeContainerId, targetZone) (kanban.ts, unit tested) and wired it into isAllowedMove.
2. (minor) The DragOverlay's floating ghost didn't pass hideEpicLink, so dragging a nested child showed the "part of Epic" badge in the drag ghost even though the resting nested row hides it — a visible flicker. Fixed: compute activeItemIsNested from the item's current dnd-kit container and pass it through.
3. (comment policy) Several new comments were tagged "TASK-186: ..." — history narration per CLAUDE.md's Code Comment Policy. Removed the task-number tags, kept the underlying WHY content.

Re-verified after fixes: unit 783 pass (+3 new: kanban.test.ts isDisallowedEpicNestEscape), lint clean, tsc clean. Re-ran manual browser verification for finding #1 specifically (fresh throwaway epic+child+flat-target, cleaned up by id after): confirmed a nested child dragged toward the flat Icebox list now stays correctly nested (no escape), and the core drag-out-to-board feature still works unaffected by the fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Nested Icebox children (a container's accordion) can now be dragged out to Current/Backlog — the only UI gap the owner reported (Icebox rows have no state-transition buttons, so drag was the sole path and it was completely unwired). Same-nest sibling reordering also works safely. Scoped down from the original 3-AC draft via fable-advisor: the reverse drag-in direction (TASK-187) and container-row-self reordering (TASK-188) need new backend capability and are split out, assigned to @claude-opus-4-8. Two real bugs found and fixed during review/manual verification: a dead-control same-nest-reorder rejection, and a same-nest reorder that was silently mis-scheduling the story to Current server-side instead of just reordering it. Verified via 780 unit tests + real-browser manual testing (precise synthetic PointerEvent dispatch, since the browser tool's built-in drag primitive didn't reliably trigger dnd-kit for this narrow-sidebar case).
<!-- SECTION:FINAL_SUMMARY:END -->
