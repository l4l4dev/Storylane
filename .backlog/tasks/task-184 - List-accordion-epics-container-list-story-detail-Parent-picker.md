---
id: TASK-184
title: List accordion + /epics container list + story-detail Parent picker
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 04:08'
updated_date: '2026-07-24 11:28'
labels: []
milestone: m-6
dependencies:
  - TASK-180
documentation:
  - doc-18
type: feature
ordinal: 2200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The remaining container-viewing surfaces (doc-18 §9): List-view 1-level accordion, /epics repurposed as the container list, and the story-detail Parent picker replacing the old Epic dropdown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 List view: top-level rows are parent_id IS NULL; a container renders as a collapsible parent (epic_color + roll-up progress) expanding to children ordered by position; a child never also appears top-level
- [x] #2 /projects/[id]/epics lists every is_container story with its roll-up progress bar, linking to story detail (route + Epics nav label kept)
- [x] #3 story detail: former Epic dropdown becomes a Parent picker (lists containers; sets parent_id; single-level trigger rejects illegal choice), overflow menu Promote item replaced by Split entry
- [x] #4 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
- [x] #5 Parent picker confirms before nesting under a not-yet-container target (that target becomes an epic and loses points/state/iteration, doc-18 §4/§9); no confirmation when the target is already a container
- [x] #6 Parent picker writes parent_id through local+synced state (not just the DB) so a field autosave never resends a stale detail.parentId, and realtime reconciliation includes parentId — a server-side reparent (Parent picker, split_story, or a concurrent session) must not be reverted by a subsequent autosave (found in TASK-180 /code-review; story-detail-panel.tsx:157 + realtime mergeRemote LOCKABLE_FIELDS)
- [x] #7 Story-detail overflow menu is container-aware: a container hides/disables Move to project / Copy to project (the split_story/move/copy RPCs reject containers server-side, doc-18 §8) and Split; StoryDetail must surface is_container for this (found in TASK-181 /code-review)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-07-24 (from TASK-181 /code-review #5): the Split entry (AC#3) is HIDDEN for personal-project stories — option A. Splitting a personal task would containerize it (drops from My Work) with unassigned children (also absent from My Work), so it appears to vanish. So the overflow Split item shows only for non-personal, non-child, non-container stories. (Personal projects keep no Split affordance, mirroring the old Promote-hidden behavior — but for a UX reason now, not the promote data-loss reason.)

From TASK-181 /code-review (#5): the story-detail Delete confirmation should be container-aware. Deleting a container ungroups its children (parent_id ON DELETE SET NULL -> children become top-level; no data loss), but the dialog only warns about comments. Add an 'its N child stories will be ungrouped' notice when detail.is_container. Pairs with the container-aware Move/Copy hide already noted for this task.

From TASK-182 /code-review (2nd pass):
- Container-aware detail must ALSO hide the Points/estimation field: doc-18 §4 accepts a raw CHECK error on the points path only because 'the UI never offers a points field on a container'. Today story-fields.tsx hides points for personal projects only, so once containers are reachable from the List/epics surfaces this task adds, editing a container's points autosaves via update_story and hits the raw stories_container_off_board_check. Hide it (alongside the Move/Copy hide + Delete ungroup notice already noted).
- lib/utils/epics.ts (epicProgress) + components/features/epics/epic-progress-bar.tsx (+ their tests) are dead since TASK-178 gutted the epics UI; packages/core container-rollup.ts is the roll-up authority now. When rebuilding /epics as the container list, either repurpose EpicProgressBar for the roll-up breakdown or delete both with their tests.

Minor (TASK-182 /code-review #4): story.containerized is only logged when the source had non-null points (TASK-179 wrote it as a points-loss audit), but activity.ts renders it as an event ('turned X into an epic'), so containerizing an UNESTIMATED story produces no timeline entry. This task makes containerization a first-class user action (Parent picker), so decide here: recommended = make recompute_is_container log story.containerized unconditionally (old_points nullable in the payload) so the render is truthful; alternative = leave as a points-loss audit and soften the wording. Low priority, cosmetic.

Implemented (branch feat/epic-story-unification). AC#3 scoped: Parent picker done here; the Split menu item itself is deferred to TASK-183 (which owns the /stories/[id]/split route — adding it here first would 404 until 183 lands, the same TASK-181 mistake). AC#4 (fable-advisor design review) done — see below.

AC#1 List view Icebox accordion — advisor-reviewed design (3 candidates considered): a container's row structurally can only ever live in Icebox (state_id permanently NULL, doc-18 §4) — no fragmentation across zones as initially feared, since zoneForStory already routes any null-state row to Icebox unconditionally. Current/Backlog children keep rendering in their own zone unchanged (doc-18 §1 'exactly like any story today'), with a 'part of Epic' link back (ux-principles principle 8). Implementation: board/page.tsx fetches containers separately + builds containerAccordionRows (packages/core rollupContainer via epics-list.ts, rollup counts children from EVERY zone, only iceboxChildIds feed the nested accordion). board-list-view.tsx's toListItemContainers excludes a story with parentId set from the flat Icebox list (nests under its container's EpicAccordionRow instead — read-only, no drag, v1 scope per AC's display-only wording). BoardStory gains parentId/parentEpicTitle (precomputed server-side) so story-list-row.tsx's badge needs no prop-drilling through the row-wrapper chain.

Advisor found + fixed 2 issues before browser check: (1) container query ordered by number instead of position (doc-18 §2 says containers share the single stories.position space) — fixed to .order('position'). (2) spec/screens.md's 'Container accordion' bullet read as requiring ALL children (any zone) to nest, contradicting doc-18 §1 — corrected the spec wording to match the actual (correct) Icebox-only-nesting design, so a future session doesn't misdiagnose this as a spec violation.

Also found + fixed during browser verification (not advisor-flagged): kanban-board.tsx's Icebox toggle badge used the raw unfiltered iceboxStories.length, double-counting a nested child (badge said '1' while the accordion's own header correctly said '0' since the child moved from a flat row to nested). Fixed: badge now counts top-level rows only (containerAccordionRows.length + non-nested icebox stories).

Manual browser verification (dev server + local Supabase, fresh test project): confirmed end-to-end — Parent picker shows the confirmation dialog exactly as designed when picking a not-yet-container target ('X will become an epic and leave the board...'), no dialog when picking an existing container; Icebox accordion renders the container with epic_color dot + progress bar, nests only its Icebox child, collapses/expands correctly; toggle badge count now correct; /epics lists the container with its roll-up and links to story detail; story detail correctly hides Points/Parent picker for the now-container story; overflow menu hides Move/Copy and shows the exact 'Its 1 child story will be ungrouped (they become top-level stories, not deleted)' Delete wording; a Backlog child (state assigned) shows the 'Big Feature' epic-link badge in its row and is correctly excluded from the Icebox accordion; rollup progress bar correctly aggregated to 0/2 done across both zones after adding the second child.

Verified: unit 714 pass, lint + tsc clean, full manual browser walkthrough (see above).

/code-review (post-browser-verification) found 3 issues, all fixed:
1. (real bug) containerAccordionRows in board/page.tsx was built from `cards` (already filtered to exclude stories in a finalized/done iteration), so a container's roll-up silently omitted any child that had moved to iteration history — disagreeing with /epics (which queries all children directly). Fixed: build accordion children from the raw `stories` fetch instead of `cards`.
2. /epics ordered containers by `number` while board/page.tsx's container query was already advisor-corrected to `position` (doc-18 §2: shared position space) — the two epic-listing surfaces disagreed on order. Fixed: /epics now also orders by `position`.
3. DEFAULT_EPIC_COLOR (#6366f1, the old epics table's default) was duplicated verbatim in board-list-view.tsx and epics/page.tsx. Fixed: moved to epics-list.ts as a single exported constant, both call sites import it.
Re-verified: unit 714 pass, lint + tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Icebox accordion (advisor-designed: containers structurally confined to Icebox, Current/Backlog children keep their zone + get an epic-link badge), Parent picker with containerize confirmation, /epics rebuilt on packages/core rollup, container-aware overflow menu (Move/Copy hidden, Delete ungroup notice), parentId realtime-synced (fixes TASK-180 finding). Split menu entry deferred to TASK-183 by design. Advisor review (2 fixes: position ordering, spec wording) + browser walkthrough both passed.
<!-- SECTION:FINAL_SUMMARY:END -->
