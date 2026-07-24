---
id: TASK-187
title: >-
  Icebox accordion: drag a Current/Backlog story back into a container's Icebox
  nest
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 13:48'
updated_date: '2026-07-24 16:27'
labels: []
milestone: m-6
dependencies:
  - TASK-184
documentation:
  - doc-18
ordinal: 1710
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split from TASK-186 per fable-advisor review (2026-07-24): the symmetric counterpart to TASK-186's "drag a container's Icebox child out to Current/Backlog" — dragging a Current/Backlog story onto a container's Icebox accordion row to re-parent it there (parent_id = that container) and demote it to that container's Icebox nest.

Unlike TASK-186 (which only reassigns state_id/iteration_id — parent_id never changes), this direction genuinely needs new backend capability: neither existing RPC covers it alone.
- update_story (20260724051506_epic_story_unification_rpcs.sql) writes parent_id but never touches position.
- move_story_board (20260722000001_move_story_board_iteration_guard_range.sql) handles state/iteration + position + the advisory lock + staleness check, but has no parent_id parameter.

Approach (fable-advisor, re-reviewed 2026-07-25 before implementation): extend move_story_board's p_deltas with an optional parent_id, written in the same UPDATE as state_id/iteration_id so the existing stories_enforce_single_level_nesting / stories_maintain_is_container triggers apply automatically (no hierarchy validation re-implemented in the RPC). Reuses its existing pg_advisory_xact_lock(project_id) and staleness machinery.

CORRECTION (fable-advisor retracted its own earlier instruction, 2026-07-25): an earlier draft of this task said to resolve "the position scope to this container's Icebox children". That is wrong and must NOT be done. move_story_board's 'single'-zone scope predicate keys only on state_id/iteration_id and never references parent_id, so the flat top-level Icebox rows and EVERY container's nested Icebox children already share ONE dense position sequence (this is why TASK-186's same-nest reorder works by sending target_zone "icebox"). Introducing a per-container position scope would fragment a correctly-shared sequence — the exact hazard flagged for TASK-188's separate container-row scope. The position machinery needs zero changes here; writing parent_id is the only new capability.

Explicitly NOT in scope here: the Parent picker's "target becomes an epic" containerize-confirmation dialog (spec/screens.md / doc-18 §9) never applies — the drop target here is always an EXISTING container (is_container already true), so no confirmation is needed and that dialog logic must not be reused/triggered by this path. Also out of scope, and correctly left rejected-with-silent-revert by the existing isAllowedEpicNestDrop / isDisallowedEpicNestEscape guards: moving a nested child into a DIFFERENT container's nest, and detaching a nested child to the flat Icebox list. (fable-advisor 2026-07-25: those are out-of-AC operations whose snap-back matches the spec-sanctioned estimation-gate pattern — not the TASK-186 dead-control defect, which was an in-AC operation being blanket-rejected.)

No RPC-level is_container guard on the target parent (fable-advisor 2026-07-25): update_story already writes an arbitrary p_parent_id unvalidated, delegating the invariant to the maintain_is_container trigger (auto-containerize + points audit log) per decision-1. Adding a check only here would be inconsistent with that established pattern.

Architecture-sensitive (RPC surface change, staleness contract, concurrency) — per CLAUDE.md's Backlog Assignee & Model Policy, this is an @claude-opus-4-8 task, not @claude-sonnet-5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dragging a Current/Backlog story (any parent, or none) onto a container's Icebox accordion row sets parent_id to that container and demotes it to that container's Icebox nest (state_id/iteration_id cleared per the existing icebox-crossing rule)
- [x] #2 The move is placed with a dense position among that container's existing Icebox children (anchor-based, consistent with dropStoryInList's before_item_id pattern) — no upward-shift renumbering of unrelated rows
- [x] #3 No containerize confirmation dialog fires (the target is already a container)
- [x] #4 Concurrent-safe: reuses move_story_board's existing pg_advisory_xact_lock(project_id) + staleness check rather than a new lock
- [x] #5 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch main (advisor-consulted before implementing and design-reviewed after, per AC#5).

Pre-implementation advisor consult corrected this task's OWN premise: the earlier draft's "resolve the position scope to this container's Icebox children" was retracted by its author. move_story_board's 'single'-zone predicate keys on state_id/iteration_id and never references parent_id, so the flat Icebox rows and every container's nested children already share ONE dense sequence (which is why TASK-186's in-nest reorder works by targeting the plain "icebox" zone). A per-container scope would have fragmented it. Position machinery therefore UNCHANGED; writing parent_id was the only new capability. Task Description corrected before implementing.

Also settled in that consult: scope stays strictly AC#1 (cross-container moves and detach-to-flat-Icebox remain rejected — out-of-AC operations whose snap-back matches the spec-sanctioned estimation-gate pattern, NOT the TASK-186 dead-control defect, which was an in-AC operation being blanket-rejected); parent_id joins the staleness snapshot ("it's a deliberate drag" is not a reason, since state_id/iteration_id are equally drag-driven and already checked); and NO RPC-level is_container guard (update_story already writes an arbitrary p_parent_id unvalidated, delegating to the maintain_is_container trigger per decision-1 — a check only here would break that pattern).

DB (migration 20260724153129): create-or-replace of move_story_board, verbatim except three things — the FOR UPDATE read also selects parent_id; the staleness comparison includes it; and a GUARDED second statement writes it (`if v_new_parent is distinct from v_story.parent_id`). Keeping the parent write out of the existing state/iteration UPDATE is not cosmetic: Postgres fires `update of <column>` triggers based on the column appearing in the SET list, NOT on the value changing, so a single combined statement would have run enforce_single_level_nesting + maintain_is_container (3 extra queries) on EVERY board drag. Hierarchy legality and containerization stay entirely with those triggers — no validation re-implemented in the RPC.

Server action: moveExpected() now REQUIRES parent_id in its parameter type, so tsc located all 3 call sites (fail-closed — deliberately not a `p_expected ? 'parent_id'` fail-open guard, which would silently lose the protection for any caller that forgot it). Both story SELECTs fetch parent_id; createDraftStory passes null (freshly inserted, cannot have a parent yet). dropStoryInList reads an optional parent_id form field and merges it into p_deltas.

Client: two new pure helpers in kanban.ts — epicIdFromZone (inverse of epicIceboxZoneId) and isEpicNestAttach (shape-only: from outside any nest into a nest). isAllowedMove's epic-nest branch became `isAllowedEpicNestDrop(...) || (isEpicNestAttach(...) && evaluateListDrop(story, from, ICEBOX_COLUMN_ID, gates).ok)` — so an attach still has to clear the ordinary Icebox crossing rule (an in-progress story cannot be parked in an epic). isAllowedEpicNestDrop / isDisallowedEpicNestEscape untouched. handleDragEnd sends parent_id for any drop inside a nest, including an in-nest reorder where it equals the current parent — the RPC's `is distinct from` guard makes that a no-op, so one uniform payload covers both cases.

Post-implementation advisor design review: approved, ONE fix required — EpicAccordionRow's doc comment still claimed "dropping one back in is TASK-187 ... isAllowedMove rejects that direction for now", false as of this change. Rewritten to describe the shipped behavior. Advisor separately confirmed AC#3/principle-8: no confirmation is correct here (spec/screens.md 295-299 already clears state/iteration without confirmation on every Icebox crossing; doc-18 §9 explicitly exempts an already-container target; points are preserved, only scheduling is cleared) and the relation stays visible since the story renders in the accordion immediately.

Verified: supabase db reset clean; types regenerated (no diff — the RPC's jsonb signature is unchanged); integration 505/505 across the whole suite, including 4 new move_story_board tests (attach + AC#2 dense placement before the sibling, parent_id staleness rejection, single-level-nesting trigger delegation, and a regression guard that a delta-less move leaves parent_id alone — TASK-186's drag-out); unit 788 (+5 new pure-helper tests); lint + tsc clean. Real-browser walkthrough on a throwaway project (deleted by id after): dragging a Backlog story onto an epic's nest attached it, with parent_id/state_id/iteration_id/position all confirmed directly in the DB and the epic's roll-up updating to 0/2 done · 2 pts; an in-progress story dropped on the same nest was correctly refused (snap-back, DB unchanged).

/code-review (post-advisor, owner-run) returned 10 findings; all addressed.

1. (real bug, confirmed by tracing handleDragOver) The nest guards read the drag's origin from the LIVE containers state, which onDragOver has already mutated optimistically — so mid-drag they saw wherever the pointer had been, not where the drag began. Routing a nested child up through Current and back down defeated both the detach guard and the cross-container guard. Fixed by a better formulation than the reviewer's: classify from the story's OWN parent_id (a server-confirmed field no reorder touches) instead of any zone the drag passed through. That is immune to optimistic state by construction and additionally closes a case neither the review nor the earlier design caught — a parented story sitting in Current dragged onto the flat Icebox, which would have re-nested itself on the next render.
2. (deploy-window bug) `p_expected->>'parent_id'` cannot distinguish an absent key from JSON null, so a caller omitting it would have had every move of a PARENTED story rejected as "stale" — a false reason. The RPC now demands the key and says so. This surfaced 17 pre-existing direct-RPC test callers that predate the contract; all updated (move-story-board + stories-write-model integration suites).
3. + 10. (comment was wrong; capability pre-existing) Verified against update_story: it already writes an arbitrary p_parent_id unvalidated, so this diff adds no new attack surface — the advisor's read was right. But the comment I had written claimed the triggers validate "whether the target container may legally hold this story", and they deliberately do NOT check is_container. Corrected, and the action's trusted read now confirms the target is a real container in this project before building the delta — consistent with dropStoryInList's own never-trust-the-client discipline rather than with the RPC layer. Doubles as the malformed-uuid guard (finding 10): a non-uuid matches no row instead of surfacing a raw 22P02.
4. (comment policy) Stale docblocks describing TASK-187 as unimplemented future work removed, along with a "TASK-187" history-narration tag in actions.test.ts.
5. (no tests) Added 4 server-action tests covering the wiring the suite never exercised: nest drop sends parent_id, non-nest omits it, an empty form value degrades to no-attach, and a non-container target is refused without calling the RPC. Mutation-checked: reverting the implementation fails 2 of them.
6. Reorders no longer send a parent delta at all (only a genuine attach does), so a position-only move stays clear of the parent staleness check.
7. (test quality) seedContainerWithIceboxChild no longer hardcodes positions 50/51 outside the sequence; the AC#2 assertion is now relative order within the state_id-null set rather than absolute literals.
8. dropStoryInList now revalidates /my-work — an attach clears state_id/iteration_id, so the story leaves My Work exactly as createDraftStory's icebox target does.
9. (simplification) isEpicNestAttach / isAllowedEpicNestDrop / isDisallowedEpicNestEscape — three predicates over the same zone-key prefix, whose drift was the source of finding 4 — collapsed into one classifyNestDrop returning none | reorder | attach | rejected.

Re-verified after the fixes: unit 790, integration 508 (whole suite), lint + tsc clean. Browser: the laundering route from finding 1 is confirmed blocked (nested child dragged via Current onto the flat Icebox leaves the DB untouched).

OUTSTANDING: the attach gesture itself has NOT been re-confirmed in a browser since the parentId refactor. Synthetic PointerEvents stopped activating dnd-kit's PointerSensor partway through this session (an instrumented probe in isAllowedMove never fired), so the harness could not drive the drag. Pre-refactor the same gesture was browser-verified end-to-end with the DB checked; the refactor changed one argument (origin zone -> story.parentId) whose function is unit-tested for both inputs, and the action + RPC layers are covered by the tests above. Owner asked to confirm gesture 3 (drag a Backlog story into an epic's nest) manually.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
move_story_board learns to write parent_id, making 'drag a board story into an epic's Icebox nest' possible (doc-18 §9) — the one board move that also re-parents. Advisor consult before implementing retracted this task's own premise: no per-container position scope was needed (all state-null stories already share one dense sequence), so the position machinery is untouched and only the parent write is new. The parent UPDATE is deliberately guarded and separate, because Postgres fires 'update of parent_id' triggers on the SET list rather than on an actual value change — one combined statement would have run the hierarchy triggers on every board drag. parent_id also joins the staleness snapshot, enforced fail-closed via moveExpected's parameter type. Verified with 4 new integration tests, 5 new unit tests, and a real-browser walkthrough covering both the successful attach and the correctly-refused in-progress story.
<!-- SECTION:FINAL_SUMMARY:END -->
