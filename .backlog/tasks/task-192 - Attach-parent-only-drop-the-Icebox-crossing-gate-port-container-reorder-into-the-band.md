---
id: TASK-192
title: >-
  Attach = parent only: drop the Icebox-crossing gate, port container reorder
  into the band
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-24 18:15'
updated_date: '2026-07-25 13:58'
labels:
  - web
  - db
milestone: m-6
dependencies:
  - TASK-189
  - TASK-190
documentation:
  - doc-20
type: feature
ordinal: 1760
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §5 and §7. TASK-187 made attaching a board story to an epic move it into the container's Icebox nest, which contradicts Tracker (dragging a story onto an epic links it and does not move it) and re-creates defect 3: the story leaves the zone the team scheduled it into.

New rule: dropping a story on an epic row writes parent_id and nothing else. The Icebox-crossing gate that existed only to support the old behaviour goes away, and the container-row reorder built in TASK-188 moves from the Icebox block to the Epics band.

doc-20 §7 lists what survives, moves, and is deleted — read it before touching kanban.ts or board-list-view.tsx. Stories already relocated to the Icebox by the retired behaviour are not restored retroactively.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dropping a story on an epic row sets parent_id only; state_id, iteration_id and position are unchanged, proven by an integration test
- [x] #2 isAllowedEpicNestDrop and the Icebox-crossing attach path are deleted, not left dormant
- [x] #3 Container-row reordering (CONTAINER_ROWS_ZONE_ID, isDisallowedContainerRowDrop and the collision filter) works inside the Epics band
- [x] #4 The attach-crosses-into-Icebox assertions in kanban.test.ts and move-story-board.integration.test.ts are replaced by the new contract, not extended alongside it
- [x] #5 Detaching is available from the row menu and the Parent picker; band child rows stay non-draggable in v1
- [x] #6 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
NOTE: pending fable-advisor verdict on the one deviation from doc-20 §7 (see step 1).
Steps 2-6 are independent of that verdict.

0. Already done by TASK-190 (verified by grep, zero hits repo-wide): AC#2 is satisfied —
   isAllowedEpicNestDrop, classifyNestDrop, epicIceboxZoneId/isEpicIceboxZone/
   epicIdFromZone, toServerZone and the NestDrop type are all deleted, not dormant.
   The Icebox-crossing attach branch in isAllowedMove went with them.

1. DEVIATION FROM doc-20 §7 (advisor consulted): §7 says move_story_board's parent_id
   delta survives with the caller just dropping the state/iteration deltas. It cannot:
   move_story_board's position machinery has no skip-position path, and its no-anchor
   branch unconditionally writes position = max(position)+1 (20260724153129 lines
   178-215), so any attach through it violates §5/AC#1's "position untouched". Rejected
   alternatives: update_story (whole-row RPC -> lost update on a concurrent edit) and a
   direct PostgREST update (stories UPDATE RLS limits a member to their own created/
   assigned rows, while move_story_board lets any member drag any story — the same
   gesture would gain an inconsistent permission boundary).
   => New migration: set_story_parent(p_story_id, p_parent_id) SECURITY DEFINER,
   require_project_role owner/member, explicit grant (decision-1), is_personal rejected
   (TASK-147). Validates a non-null parent is an is_container row in the same project
   (ports dropStoryInList's forged-parent_id guard — a trust boundary, kept). Writes
   parent_id ONLY, so AC#1 holds by construction. Hierarchy legality stays with the
   existing triggers (enforce_single_level_nesting, derive_is_container), not
   re-implemented here. p_parent_id null = detach, serving AC#5's row-menu action too.
   move_story_board's now-uncalled parent delta: keep in place (proposed (b)) — its
   p_expected parent_id staleness guard still matters for every other move — and replace
   only its attach-contract tests. Requires rls-security-reviewer + /code-review high.

2. actions.ts: new setStoryParent({storyId, projectId, parentId}) server action wrapping
   the RPC (ActionResult shape, revalidate board + /stories/[id] + /my-work). Strip
   dropStoryInList's attachToParentId branch entirely (its parent_id form field, the
   container-existence pre-check that moves into the RPC, and the parent_id delta) — the
   drag no longer routes attach through it.

3. board-list-view.tsx — port TASK-188's container-row zone into the band (AC#3):
   - toListItemContainers rebuilds the CONTAINER_ROWS_ZONE_ID bucket from
     containerListItems as ListItem kind "container" (the kind deleted in TASK-190 comes
     back, now fed by ContainerListItem rather than the retired ContainerAccordionRow).
   - EpicBandRow becomes a SortableItem again (drag handle returns) inside a
     SortableContext over that zone; EpicsBand's <ul> takes the block's useDroppable ref.
   - isAllowedMove: restore the isDisallowedContainerRowDrop branch (block exclusive both
     ways) BEFORE the story-shaped logic, and the "container row reorders freely" branch.
   - collisionDetection: restore the isContainerBlockDroppable filter for an epic-row
     drag, but relax it for a STORY drag so the individual epic row ids stay reachable
     (that is the attach target) while the block droppable itself does not.
   - handleDragEnd: an attach branch BEFORE the ordinary move path — when the active item
     is a story and over.id is an epic row id, call setStoryParent and return without
     reordering or touching containers (the story visually never left its zone, since
     isDisallowedContainerRowDrop already stops onDragOver from relocating it).
   - Band child rows stay non-draggable (AC#5, unchanged from TASK-190).
   - Drop affordance on the epic row while a story is dragged over it (useDroppable
     isOver) so the target is visible, not guessed.

4. Detach (AC#5): a row menu on StoryListRow shown only when the story has a parent,
   with "Remove from epic" calling setStoryParent(null). The Parent picker's existing
   None option (story-parent-picker.tsx, already implemented) is the second path — no
   change needed there.

5. Tests (AC#4 — replaced, not extended):
   - New lib/utils/set-story-parent.integration.test.ts: attach leaves state_id/
     iteration_id/position untouched (AC#1's proof), detach, forged non-container parent
     rejected, cross-project rejected, viewer rejected, personal project rejected,
     single-level nesting still enforced by the trigger.
   - move-story-board.integration.test.ts: replace the attach-crosses-into-Icebox
     assertions (the "attaches a current-iteration story to a container's Icebox nest"
     test and its seedContainerWithIceboxChild fixture usage) with the new contract;
     keep the parent_id staleness test (it guards every move, not just attach).
   - grant-lockdown.integration.test.ts: add set_story_parent to AUTHENTICATED_ALLOWLIST.
   - board-list-view.test.tsx: epic row is a drag source again; a story dropped on an
     epic row calls setStoryParent and does NOT call dropStoryInList; band child rows
     still render no drag handle.
   - Regenerate database.types.ts.
6. Full suite + lint, rls-security-reviewer, fable-advisor design review (AC#6), then
   hand to the owner for /code-review high.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor pre-implementation consult (Fable hit its session limit; ran on Opus per the
CLAUDE.md fallback): 修正付き承認. set_story_parent approved, dependent point (b) confirmed
(keep move_story_board's now-uncalled parent delta rather than spending a second migration
rewriting a 250-line function). Corrections applied:
- My "a direct client UPDATE would narrow permissions" premise was WRONG and the advisor
  caught it: 20260719000002_relax_stories_write_rls.sql (TASK-70, owner decision 2026-07-18)
  already replaced the created_by/assignee-scoped policy with an unconditional owner/member
  one. Verified myself before rewriting. The migration header now cites the real reasons —
  decision-1 §1/§2 (a business rule with a mutation belongs in the DB; a TS-only guard does
  not cover iOS, which drags on the same board) and validate+write atomicity (the old
  caller-side is_container select was a TOCTOU window).
- The "parent must be an epic" rule must NOT move into enforce_single_level_nesting: the
  Parent picker deliberately containerizes bottom-up behind a confirmation (doc-18 §9), so
  the rule is drag-path-only and lives in the RPC. This is also what makes (b) safe — the
  delta left in move_story_board grants nothing update_story doesn't already allow.
- Do not lock the parent row: A→B and B→A attaches would deadlock. recompute_is_container
  re-reads it FOR UPDATE afterwards, so a racing unpin still converges. Documented in the SQL.
- is_personal rejected on attach only (detach must stay possible), and it is NOT a seal —
  update_story can still reparent a personal task. Comment says so.
- UX: an attach moves nothing on screen, so the drop needs proof (ux-principles principle 2).
  handleDragEnd expands the band and the target epic on success; the epic row also highlights
  while a story is over it (useDroppable isOver).
- revalidate: board + /projects/[id]/epics + /stories/[child] + /stories/[parent] (the epic's
  detail lists its children). NOT /my-work — an attach no longer touches state/iteration.

AC#2 was already satisfied before this task started: TASK-190 deleted isAllowedEpicNestDrop,
classifyNestDrop, epicIceboxZoneId/isEpicIceboxZone/epicIdFromZone and the NestDrop type
outright (repo-wide grep: zero hits), along with the Icebox-crossing branch in isAllowedMove.

Implemented: migration 20260725131513_set_story_parent.sql; setStoryParent server action
(dropStoryInList lost its parent_id field, its caller-side is_container select and the
parent_id delta); CONTAINER_ROWS_ZONE_ID ported into the band (epic rows are SortableItems
again, the band's <ul> is the block droppable, isAllowedMove/collisionDetection restored —
the story-drag branch of the collision filter is NEW: individual epic rows must stay
reachable as attach targets while the block itself must not); toServerZone restored in
kanban.ts for the band's zone key; attach branch in handleDragEnd ahead of the move path;
StoryEpicMenu ("Remove from epic") on rows that have an epic, with onError threaded through
SortableListRow/ListSection/IceboxColumn to the view's existing banner.

Verified: set-story-parent.integration.test.ts 9 tests (AC#1 asserts the story's AND its
neighbour's position are unchanged, per the advisor's request to catch a silent
resequencing); move-story-board.integration.test.ts's attach-crosses-into-Icebox test and
its single-level-nesting delta test deleted, staleness + "leaves parent_id untouched" kept;
actions.test.ts's two attach-through-dropStoryInList tests replaced with the new contract;
grant-lockdown allowlist updated. Full suite with SUPABASE_INTEGRATION=1 after a clean
supabase db reset: 1055 passed. lint + tsc clean. database.types.ts regenerated (additive).

rls-security-reviewer pass: no security hole. Verified fail-closed for viewer/non-member/
cross-project, forged parent_id rejected, every trigger that touches board columns audited
as inert for this UPDATE, TASK-182's is_container guard not reopened, grants correct. Two
findings, both fixed:
- Self-parent was the one forged-parent shape the suite missed: an epic named as its own
  parent SATISFIES this RPC's is_container check (it is a container), so the refusal comes
  from enforce_single_level_nesting instead, with a different message. Defence in depth
  works; the gap was test coverage. Added.
- My deadlock comment was wrong, confirmed against the trigger source before rewriting:
  maintain_is_container's AFTER trigger calls recompute_is_container, which locks the
  parent FOR UPDATE anyway — so not locking it in the exists() check does NOT avoid an
  A→B/B→A deadlock, it only shortens how long that lock is held. Comment now says that,
  and why the unlocked read is still safe (the AFTER trigger re-reads under its own lock,
  so a racing unpin converges). Pre-existing exposure shared with every reparenting caller.

fable-advisor design review (AC#6, ran on Opus — Fable's window was closed): 修正付き承認,
both corrections were real behaviour bugs and are fixed:
- Hit targets were dishonest (principle 7). An expanded epic row's rect encloses its
  mirrored children, so its centre sits ~100px below its own header, and closestCenter
  ranks by centre distance: aiming at an epic's title could attach to a NEIGHBOURING epic,
  or resolve to a Current/Backlog row and turn an attach into a real reschedule — breaking
  doc-20 §5's "the zone never changes" through a mis-hit. Fixed by extracting
  components/features/board/list-collision.ts: a story drag now asks pointerWithin about
  the epic rows FIRST and takes whatever the pointer is literally inside; everything else
  keeps closestCenter. Deliberately NOT a view-wide pointerWithin — a zone's own <ul> also
  contains the pointer, so over.id would come back as the zone id and the reorder would
  lose its row anchor. Keyboard drags return no pointer coordinates and fall through
  unchanged.
- The "non-draggable" mirror child rows were draggable in practice: they render inside the
  epic's own listener-bearing <li>, so they inherited cursor-grab and dragging one dragged
  its whole epic — looked grabbable, moved something else (principle 1, and an AC#5
  violation in fact if not on paper). Fixed by stopping pointerdown on the children <ul>
  and cancelling the inherited cursor there; the child's click (peek) is unaffected since
  only the sensor's pointerdown is stopped.
Advisor confirmed as correct, no change needed: the asymmetric collision filter, "⋮" shown
only on rows that have an epic (principle 1 forbids a disabled control with a
tooltip-only reason, not a hidden one), the isOver ring (no layout shift, principle 3), and
a re-attach to the same epic staying a silent ok (the ring already committed to the target).

New tests: list-collision.test.ts (5, algorithms injected as spies since jsdom has no
layout — asserts the pointer phase wins outright, the fallback hides the band's block from
a story, keyboard drags keep the old path, and an epic drag never goes pointer-first) plus
the mirror-row cursor assertion.

Re-verified after all fixes: clean supabase db reset, full suite with SUPABASE_INTEGRATION=1
1061 passed, lint + tsc clean.

/code-review high: 5 findings, all verified against the source and all fixed. The SQL,
grants, toServerZone mapping and the revalidate set were reviewed clean.
- MEDIUM: the attach branch returned without reverting the optimistic drag. onDragOver
  relocates on every hover, so a story dragged up to the band THROUGH Current was already
  rendered in Current when the attach fired — the board then showed a zone the server was
  never told about until revalidate. (The error path was already correct via runDrop's
  restoreItemPosition; only the success path leaked.) Now calls revertToSnapshot() first.
- MEDIUM: EpicsBand rendered the raw containerListItems prop while handleDragEnd wrote the
  reorder into containers[CONTAINER_ROWS_ZONE_ID], so the optimistic epic reorder was
  write-only: the row snapped back until revalidate, and a second drag started before that
  computed its anchor from an order the user was not looking at. The band now renders from
  the optimistic zone (epicRows), which is also what containerRowIds derives from.
- MEDIUM: list-collision.ts's fallback phase excluded only the block, leaving the epic ROW
  ids competing on centre distance. The band sits directly above Current, so a story
  dropped in the gap could win an epic and silently gain a parent it was never dragged
  onto — invisible, since attach moves nothing. The fallback now hides the whole band from
  a story drag (isContainerBlockDroppable inverted), making attach reachable only through
  the deliberate pointer-inside gesture.
- LOW: the isOver ring also fired when one epic was dragged over another — the same signal
  that means "drop to attach" shown for a reorder that cannot attach. Epic rows now carry
  their own drag type (EPIC_ROW_DRAG_TYPE) so the row can tell the two apart; the ring is
  gated on the active item not being an epic row.
- LOW: expandGroup ran before the RPC resolved, so a failed attach left an opened,
  childless epic beside the error banner (the band's children are a server prop, not
  optimistic). Moved into the success path.

Findings 1 and 2 are drag-time behaviours jsdom cannot reproduce (no layout, no real
pointer-distance drag), so they are covered by the manual verification steps rather than
tests — the steps call out dragging a story to the band THROUGH Current specifically,
which is finding 1's exact repro. Finding 3 is covered by list-collision.test.ts.

Re-verified: clean supabase db reset, full suite with SUPABASE_INTEGRATION=1 1061 passed,
lint + tsc clean.
<!-- SECTION:NOTES:END -->
