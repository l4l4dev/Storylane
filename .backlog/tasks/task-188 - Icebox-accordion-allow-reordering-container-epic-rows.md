---
id: TASK-188
title: 'Icebox accordion: allow reordering container (epic) rows'
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-07-24 13:48'
updated_date: '2026-07-24 18:12'
labels: []
milestone: m-6
dependencies:
  - TASK-184
documentation:
  - doc-18
ordinal: 1720
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split from TASK-186 per fable-advisor review (2026-07-24): container ("epic") rows currently render in their own block above the Icebox's flat list (board/page.tsx, containerAccordionRows), read-only, ordered by position — there is no write path to reorder them. Not a reported owner pain point, just a natural completeness gap.

CORRECTION (2026-07-25, fable-advisor retracting its own earlier claim after both of us traced the SQL): an earlier draft of this task warned that a container reorder needed "a brand-new splice scope isolated to (project_id, is_container=true), structurally isolated from the existing Icebox splice scope (_splice_backlog's iteration_id IS NULL AND state_id IS NULL scope)". Both halves are wrong:
- _splice_backlog (20260719000008) is scoped `iteration_id is null and state_id is not null` — that is the BACKLOG zone (spec/data-model.md "Backlog zone predicate"), unioned with backlog_dividers. A container's state_id is permanently NULL (off-board CHECK, doc-18 §4), so a container can never reach that function. There is nothing to piggyback on or isolate from.
- The real Icebox ordering path is move_story_board's 'single' zone, whose scope predicate is `state_id is null` with no is_container/parent_id filter, so containers, flat Icebox rows and every container's nested children already share ONE dense sequence. spec/data-model.md already states this outright ("no separate 'epic-internal' position scope", doc-18 §2). Its anchored branch does a BOUNDED range shift — only rows between the vacated slot and the target — so relative order outside that range is invariant; only absolute integers move by ±1.

Therefore: no new RPC, no new splice scope, no migration. This is pure client wiring, exactly as TASK-186 turned out to be.

Design (advisor-approved 2026-07-25): add a `kind: "container"` ListItem and give the accordion block its own dnd-kit container key (following the existing `epic:<id>` pattern); gate isAllowedMove so a container only ever reorders among containers (a container dropped in the flat Icebox list, or a plain story dropped in the container block, are both rejected); call the existing dropStoryInList with target_zone "icebox", a `story:<containerId>` anchor, empty deltas and no parent delta. ContainerAccordionRow needs no `position` field — the array order supplies the anchor.

Model note (advisor 2026-07-25): the "architecture-sensitive (new RPC, new position-scope design, concurrency)" rationale for assigning this to @claude-opus-4-8 no longer holds now that no backend work is involved; @claude-sonnet-5 would be the fitting assignee. Owner's call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A container's own row in the Icebox block can be dragged to reorder among other containers
- [x] #2 Reordering reuses move_story_board's existing Icebox path ('single' zone, state_id IS NULL) — no new scope, RPC or migration. Integration test verifies relative-order invariance BOTH ways: reordering containers leaves the flat Icebox items' and nested children's relative order untouched, and reordering a flat Icebox item leaves the containers' relative order untouched
- [x] #3 Reuses the existing pg_advisory_xact_lock(project_id) concurrency pattern; no new lock introduced
- [x] #4 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch main. Advisor-consulted before implementing and design-reviewed after (AC#4).

Pre-implementation advisor consult retracted this task's OWN premise (which came from the same author's earlier TASK-186 review): the warning to build "a new splice scope isolated to (project_id, is_container=true), isolated from _splice_backlog's iteration_id IS NULL AND state_id IS NULL scope" was wrong twice over. _splice_backlog is scoped `state_id is NOT null` (the Backlog zone) — a container (state_id permanently NULL, off-board CHECK) can never reach it. The real Icebox path is move_story_board's 'single' zone (state_id is null, no is_container/parent_id filter), so containers, flat Icebox rows and every nested child already share ONE dense sequence — spec/data-model.md states this outright ("no separate epic-internal position scope", doc-18 §2). Its anchored move is a bounded range shift, so relative order outside the moved range is invariant; only absolute integers shift ±1. Therefore: no RPC, no migration, no new scope. Task Description + AC#2 corrected before implementing.

Implementation (TDD, all client + tests):
- kanban.ts: CONTAINER_ROWS_ZONE_ID; isDisallowedContainerRowDrop(isContainerRow, targetZone) — the block is exclusive both ways (`isContainerRow !== (targetZone === CONTAINER_ROWS_ZONE_ID)`), so a container never leaves it and no ordinary story enters; toServerZone maps the container zone back to plain "icebox" (shared sequence).
- board-list-view.tsx: added a `kind: "container"` ListItem (carries a ContainerAccordionRow, no BoardStory — containers are fetched separately and excluded from the board cards). toListItemContainers builds containers[CONTAINER_ROWS_ZONE_ID]. The accordion block is now a SortableContext, each row wrapped in the existing SortableItem (whole row = drag handle, same convention as story rows; collapse/peek buttons still fire on an under-threshold click via PointerSensor distance:5). isAllowedMove gained the isDisallowedContainerRowDrop gate BEFORE any story-shaped logic (a container has no .story). handleDragEnd normalizes the client-only "container" kind to "story" for both item_kind and the before-anchor (a container IS a story row server-side, is_container=true); calls the existing dropStoryInList with target_zone "icebox", no parent delta. Extracted ContainerRowHeader for the DragOverlay ghost.

Post-implementation advisor review: approved, one fix — a stale EpicAccordionRow doc comment still said the reorder was "still a follow-up" needing "a new position scope ... dense-rank independently of the flat Icebox splice" (the retracted premise). Rewritten to the shipped reality. Advisor confirmed Q1 (rejected-drop silent snap-back matches the site-wide estimation-gate pattern, no new principle-2 violation) and Q2 (whole-row handle with in-row buttons is the existing StoryListRow convention, principle 7 satisfied). Also flagged an assignee typo (@claude-opus-5 -> corrected to @claude-opus-4-8).

Verified: unit 796 (5 new pure-helper tests for the container zone + a component wiring assertion that the row renders draggable), integration 515 across the whole suite incl. 2 new move_story_board relative-order-invariance tests (reordering containers leaves flat rows + nested children in relative order; reordering a flat row leaves the containers in relative order — proving no separate scope is needed), lint + tsc clean. Real-browser walkthrough on a throwaway 2-epic + 2-child + flat-row project (deleted by id after): reordering the two containers swapped only them (children stayed with their epics, flat row unmoved, DB confirmed); a container dragged onto the flat list was rejected (snap-back, DB unchanged); the flat story dragged into the container block was rejected too.

/code-review (medium) findings, all four confirmed and fixed before commit:

- HIGH x2 — wrapping EpicAccordionRow in SortableItem made the container row's <li> a droppable ENCLOSING that epic's nest droppable and every nested child row, and collisionDetection={closestCenter} ranks purely by centre distance with no notion of nesting. Past one child the enclosing row's centre sits among the children's, so at pixel-dependent points a TASK-187 attach / TASK-186 drag-out resolved to CONTAINER_ROWS_ZONE_ID and reverted, and (mirror case) a container dragged over another expanded epic resolved to that epic's nest and reverted — leaving only the thin header strip reliably droppable, breaking this task's own feature. The manual walkthrough passed only because the throwaway project had one child per epic, where the child wins on distance. Fix: isContainerBlockDroppable + a collisionDetection wrapper that narrows the droppable set to the same exclusivity isDisallowedContainerRowDrop already enforces, so each drag only competes against targets its drop gate would accept. No nesting-aware algorithm needed — the block is exclusive both ways, so there is no legal cross-boundary drop to disambiguate.
- MEDIUM — IceboxSection rendered the container block from the containerAccordionRows PROP (server order) while handleDragEnd updated containers[CONTAINER_ROWS_ZONE_ID], so a reorder snapped back until revalidatePath returned; every other zone here is optimistic. Fix: derive the rows from the optimistic zone at the call site.
- LOW — ContainerRowHeader's doc comment claimed it was shared by the row and the ghost; only the ghost uses it. Comment rewritten to state why the duplication stands (the row interleaves the chevron and peek buttons through the same strip).

Re-verified: unit 800 (+4 collision-filter tests), full suite 1031 passed incl. integration (SUPABASE_INTEGRATION=1), lint + tsc clean. Browser re-verification of the multi-child case is still outstanding.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Container (epic) rows in the Icebox accordion are now draggable to reorder among themselves, completing the doc-18 accordion drag chain (TASK-186/187/188). Advisor consult before implementing retracted this task's own premise: no new position scope was needed — containers already share the one Icebox sequence with flat rows and nested children (spec/data-model.md, doc-18 §2), and a bounded range shift keeps every other row's relative order invariant. So it was pure client wiring: a new dnd-kit zone for the container block, exclusive both ways (nothing enters or leaves it), mapping to the plain Icebox zone server-side. No RPC or migration. Verified with 2 new relative-order-invariance integration tests and a browser walkthrough of the reorder plus both rejection directions.
<!-- SECTION:FINAL_SUMMARY:END -->
