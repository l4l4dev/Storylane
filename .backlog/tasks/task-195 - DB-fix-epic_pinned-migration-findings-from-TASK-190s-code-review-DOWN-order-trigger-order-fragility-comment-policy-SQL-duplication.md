---
id: TASK-195
title: >-
  DB: fix epic_pinned migration findings from TASK-190's /code-review (DOWN
  order, trigger-order fragility, comment policy, SQL duplication)
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-25 03:14'
updated_date: '2026-07-28 00:50'
labels:
  - db
milestone: m-6
dependencies:
  - TASK-189
priority: medium
ordinal: 1790
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-190's /code-review (background subagent, full-repo scan) surfaced 4 findings against supabase/migrations/20260724181957_epic_pinned.sql (TASK-189, already Done and shipped) that TASK-190 did not fix, since that migration isn't part of TASK-190's diff. Filed as its own task per the owner's request instead of folding into TASK-190's commit.

Since the migration is already applied, these need a NEW forward-fixing migration (per db-migrate conventions), not an edit to the existing file in place.

1. DOWN rollback comment ordering bug (line ~1136): the DOWN block does `alter table public.stories drop column epic_pinned` BEFORE reverting derive_is_container/recompute_is_container/enforce_single_level_nesting to their pre-migration bodies -- but those CURRENT (about-to-be-reverted) trigger bodies all reference NEW.epic_pinned, so an operator following the DOWN block literally breaks every INSERT/UPDATE on stories until the function reverts are also applied. The column drop must come after the function reverts, not before.
2. Trigger-ordering fragility (line ~86): stories_aa_protect_epic_pinned firing before stories_derive_is_container depends entirely on Postgres's BEFORE-ROW alphabetical tgname ordering (the 'aa' prefix), documented only in a comment. A future trigger named e.g. stories_a_something on stories would silently reorder ahead of this guard, letting a forged epic_pinned value leak into is_container's derivation before the client-role reset runs -- nothing in the schema or test suite catches that reordering today.
3. CLAUDE.md Code Comment Policy violation (lines ~58, ~144): schema comments cite internal review-pass provenance ('not just the two below (rls-security-reviewer, TASK-189)', 'An epic can no longer be nested (/code-review, TASK-189)') -- that belongs in commit/task history, not baked into schema comments that outlive the review context.
4. SQL duplication (line ~1112): set_epic_pinned's pin branch duplicates recompute_is_container's audit-then-clear block (insert into activity_logs if points not null, then clear points/state_id/iteration_id + epic_color default) almost verbatim, and the '#6366f1' default-color literal is hand-copied 3x across this one migration (recompute_is_container, create_epic, set_epic_pinned) -- the exact class of bug TASK-183 already had to guard against once (a containerization path silently forgetting the color default).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new migration reorders the DOWN rollback comment so the trigger-function reverts happen before stories.epic_pinned is dropped, with no window where a live trigger references a dropped column
- [ ] #2 Trigger execution order between stories_aa_protect_epic_pinned and stories_derive_is_container is guarded by something stronger than a comment (e.g. an automated test reading pg_trigger, or a naming/ordering convention enforced elsewhere) so a future same-table trigger addition can't silently break it
- [x] #3 Migration comments no longer cite specific review-pass provenance (rls-security-reviewer / TASK-189 / /code-review) per CLAUDE.md's Code Comment Policy
- [ ] #4 The audit-then-clear block and the #6366f1 default-color literal are defined once and reused by recompute_is_container/create_epic/set_epic_pinned instead of hand-duplicated
- [ ] #5 rls-security-reviewer pass plus /code-review before merge (this migration touches TASK-182/TASK-189's remediation surface)
- [ ] #6 The boolean expression 'epic_pinned OR has_children' is defined once and reused by derive_is_container's trigger body and recompute_is_container's v_should_be computation, not duplicated verbatim (found by TASK-191's /code-review)
- [ ] #7 protect_stories_epic_pinned's blanket role-based exemption (any SECURITY DEFINER function bypasses the guard) is narrowed to an explicit allowlist of the two writer functions, or the gap is explicitly reviewed and accepted as low-risk with a comment explaining why (found by TASK-191's /code-review)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-191's /code-review (2026-07-25) surfaced 2 more findings against this same migration, folded in as AC#6/#7 above: the is_container boolean formula duplicated between derive_is_container and recompute_is_container, and protect_stories_epic_pinned's role-based (not allowlist-based) exemption for SECURITY DEFINER functions -- not exploitable today (verified: update_story isn't SECURITY DEFINER; split_story forces epic_pinned false on insert), but flagged as a forward-looking hardening gap.

Comment-policy violations (AC#3) fixed as a drive-by cleanup during TASK-193's /code-review response (2026-07-26), ahead of this task's own migration work: epic_pinned.sql:58/144, epic-pinned.integration.test.ts (2 spots), set-story-parent.integration.test.ts:176 all had their /code-review, rls-security-reviewer, TASK-189/192 provenance framing stripped, keeping only the actual constraint each comment states. AC#3 can be checked off without further work here. AC#1 (DOWN order), AC#2 (trigger-order fragility), AC#4 (SQL duplication), AC#6/#7 (is_container formula duplication, protect_stories_epic_pinned's role-based exemption) remain — these need a real forward-fixing migration, not just comment edits.

Re-confirmed by TASK-196's /code-review (2026-07-26): DOWN order (AC#1), trigger-order fragility (AC#2), audit-then-clear/#6366f1 duplication (AC#4), and protect_stories_epic_pinned's role-based exemption (AC#7) are all still open. New minor finding folded in: stories_aa_protect_epic_pinned and stories_derive_is_container are BEFORE INSERT OR UPDATE with no WHEN clause, so both run on every stories write (title edits, drag reorders) even when epic_pinned/parent_id are untouched -- a WHEN clause would skip both for ordinary edits. No new AC added (same migration, same fix pass); worth picking up when this task is implemented.
<!-- SECTION:NOTES:END -->
