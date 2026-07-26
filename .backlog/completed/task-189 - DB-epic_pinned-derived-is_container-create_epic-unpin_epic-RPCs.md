---
id: TASK-189
title: 'DB: epic_pinned + derived is_container + create_epic/unpin_epic RPCs'
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-07-24 18:15'
updated_date: '2026-07-24 20:09'
labels:
  - db
milestone: m-6
dependencies: []
documentation:
  - doc-20
priority: high
type: feature
ordinal: 1730
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §2. Today a container exists only while it has children (derive_is_container trigger), so an epic cannot be created top-down and cannot survive losing its last child — the root cause of two owner-reported defects (no + Add Epic, no way to file a known-big item as an epic first).

Add `epic_pinned boolean not null default false` and change the derived flag to `is_container = has_children OR epic_pinned`. The derive trigger must NOT be relaxed to let clients write is_container: that is exactly the hole TASK-182's rls-security-reviewer pass closed (a member sending is_container=false, points=5 to un-containerize a row).

epic_pinned is written only through two new SECURITY DEFINER RPCs (owner+member via require_project_role, explicit grant, decision-1): create_epic (creates a childless epic, and is also the 'make this existing story an epic' path) and unpin_epic (clears the flag; rejects while children remain).

This phase also freezes the attach contract TASK-192 depends on: setting parent_id never changes state_id, iteration_id or position.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 epic_pinned column added; is_container stays trigger-derived as (has_children OR epic_pinned); no client-writable path to is_container remains
- [x] #2 create_epic creates a childless container and can containerize an existing story, clearing points/state_id/iteration_id and logging the old points to activity_logs (doc-18 §4 flip path)
- [x] #3 unpin_epic clears epic_pinned and rejects while the story still has children
- [x] #4 The off-board CHECK still holds for a pinned childless epic (points/state_id/iteration_id NULL)
- [x] #5 Attach contract documented and tested: writing parent_id alone leaves state_id/iteration_id/position untouched
- [x] #6 rls-security-reviewer pass plus /code-review high before merge (this migration touches TASK-182 remediation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration (supabase migration new epic_pinned): add stories.epic_pinned; replace derive_is_container so is_container := epic_pinned OR has_children; add protect_stories_epic_pinned (BEFORE INSERT/UPDATE) pinning epic_pinned for client roles (authenticated/anon) so only SECURITY DEFINER RPCs can write it; replace recompute_is_container to test (has_children OR epic_pinned); add create_epic(project_id, title, description, epic_color) and set_epic_pinned(story_id, pinned) RPCs (pin = containerize an existing story: audit old points to activity_logs then clear points/state_id/iteration_id in the same UPDATE, since the off-board CHECK fires immediately; unpin rejects while children remain); grants per db-migrate item 5 + DOWN block.
2. Add create_epic and set_epic_pinned to AUTHENTICATED_ALLOWLIST in grant-lockdown.integration.test.ts.
3. New lib/utils/epic-pinned.integration.test.ts covering all six acceptance criteria, including the forged-write cases (direct PATCH of epic_pinned and is_container) and the attach contract (writing parent_id alone leaves state_id/iteration_id/position untouched).
4. supabase db reset, regenerate database.types.ts.
5. Full suite + lint, then rls-security-reviewer, then hand to the owner for /code-review high.

Naming deviation from the acceptance criteria: unpin_epic is implemented as set_epic_pinned(story_id, false) — one RPC with a boolean instead of two near-identical functions (halves the grant/allowlist/type surface). AC#3's behaviour is unchanged.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch main.

Migration 20260724181957_epic_pinned.sql:
- stories.epic_pinned (not null default false) + column comment.
- derive_is_container: is_container := epic_pinned OR has_children (replaces 20260724075153's body; the TASK-182 guard is NOT relaxed — clients still cannot write is_container).
- protect_stories_epic_pinned + trigger stories_aa_protect_epic_pinned (BEFORE INSERT OR UPDATE): forces epic_pinned false on INSERT and back to OLD on UPDATE when current_user is a client role. Inside a SECURITY DEFINER function current_user is the function owner, so the two RPCs pass through. The trigger name sorts ahead of stories_derive_is_container (Postgres fires BEFORE ROW triggers in tgname order) so the derived flag reads the guarded value — confirmed against pg_trigger by the rls-security-reviewer.
- recompute_is_container: gains the pinned term so a pinned epic keeps is_container when its last child leaves. Body carried over from 20260724121514 INCLUDING the epic_color default — the first attempt rebased on the older 20260724054954 body and dropped it, caught by nesting.integration.test.ts.
- create_epic(project_id, title, description, epic_color) and set_epic_pinned(story_id, pinned), both SECURITY DEFINER, owner/member, granted to authenticated and revoked from public/anon. Both apply the #6366f1 epic_color default (TASK-183's regression class: every containerization path must leave a colour). set_epic_pinned's pin branch repeats the audit-then-clear in ONE statement instead of calling recompute_is_container, because the pin UPDATE flips is_container through the derive trigger and the off-board CHECK would reject the statement before any AFTER trigger could clear the board fields.

Naming: unpin is set_epic_pinned(id, false) rather than a separate unpin_epic — one RPC with a boolean halves the grant/allowlist/type surface. AC#3's behaviour is unchanged.

rls-security-reviewer pass: no bypass found in either RPC, nothing lost from the two replaced bodies, trigger ordering verified empirically. Two gaps it flagged were closed: set_epic_pinned refusing a foreign project's story, and both RPCs refusing a viewer. Its systemic note (the role-based exemption covers every SECURITY DEFINER function, not only these two) is recorded as a comment on the trigger.

Verified: epic-pinned.integration.test.ts 14 tests, grant-lockdown 3, full suite 1045 passed with SUPABASE_INTEGRATION=1 after a clean supabase db reset; lint and tsc clean. database.types.ts regenerated (additive: epic_pinned + the two RPC signatures).

/code-review (high) findings — all five confirmed against the local DB and fixed before commit:

- MEDIUM — decoupling is_container from child membership broke the implicit invariant is_container => parent_id is null. enforce_single_level_nesting only rejected a story WITH CHILDREN from becoming a child, so a pinned CHILDLESS epic passed: update_story / move_story_board delegate hierarchy legality to that trigger, so a member could nest an epic under an epic (/epics would list the row twice and the outer epic could never be unpinned). Fixed by create-or-replacing enforce_single_level_nesting with 20260724054954's body verbatim plus an epic_pinned rejection.
- LOW — set_epic_pinned had no NULL guard on p_pinned: 'v_row.epic_pinned = null' is NULL, not true, so the idempotence return was skipped and the unpin branch ran, silently un-pinning an epic. Now raises.
- LOW — the idempotence early-return preceded the child-existence guard, so unpinning a container that is one only through child membership (epic_pinned already false) returned success while the row stayed an epic. The guard now runs first, so 'stop being an epic' with children always errors (AC#3).
- LOW — neither RPC had TASK-147's is_personal rejection; the personal project's creator is its sole owner, so the membership check let a direct PostgREST call containerize a My Work task. Both RPCs now reject it. NOTE for the owner: split_story has the same gap — TASK-147 put the guard on promote_story_to_epic and TASK-181 replaced that function without carrying it over. Out of scope here; flagged for a follow-up task.
- LOW — the DOWN block pointed recompute_is_container at 20260724054954 instead of 20260724121514, i.e. following it would silently revert TASK-183's epic_color default (the same rebase mistake that happened once during implementation). DOWN now names the latest body for all three replaced functions.
- LOW — create_epic's coalesce only guarded NULL, so p_epic_color = '' stored a colourless epic. Now nullif(btrim(...), '').

Re-verified after the fixes: clean supabase db reset, epic-pinned.integration.test.ts 19 tests (one per finding added), full suite 1050 passed with SUPABASE_INTEGRATION=1, lint + tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
stories.epic_pinned makes an epic an explicit thing: it can be created before it has any children (+ Add Epic) and survives losing its last one. is_container stays trigger-derived — now as (has_children OR epic_pinned) — so TASK-182's guard against a forged client write is untouched, and epic_pinned itself gets the same protection: a BEFORE trigger resets it for client roles, leaving create_epic and set_epic_pinned (SECURITY DEFINER, owner+member, non-personal projects) as the only writers. Also freezes doc-20 §5's attach contract: writing parent_id alone leaves state_id/iteration_id/position untouched.

Verified against a clean supabase db reset: epic-pinned.integration.test.ts 19 tests (childless-epic creation, containerize-with-audit, unpin guards, forged PATCH/INSERT, off-board CHECK, cross-project and viewer rejection, attach invariance, plus one per review finding), grant-lockdown 3, full suite 1050 passed with SUPABASE_INTEGRATION=1, lint + tsc clean. rls-security-reviewer found no bypass; its two coverage gaps were closed. /code-review high raised five findings (one MEDIUM: an epic could be nested under another epic because enforce_single_level_nesting only rejected stories that already had children) — all fixed with a regression test each.
<!-- SECTION:FINAL_SUMMARY:END -->
