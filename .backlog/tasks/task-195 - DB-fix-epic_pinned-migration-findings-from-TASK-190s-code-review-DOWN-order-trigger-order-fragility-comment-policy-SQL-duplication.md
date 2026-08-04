---
id: TASK-195
title: >-
  DB: fix epic_pinned migration findings from TASK-190's /code-review (DOWN
  order, trigger-order fragility, comment policy, SQL duplication)
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-25 03:14'
updated_date: '2026-08-04 10:46'
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
- [x] #1 A new migration reorders the DOWN rollback comment so the trigger-function reverts happen before stories.epic_pinned is dropped, with no window where a live trigger references a dropped column
- [x] #2 Trigger execution order between stories_aa_protect_epic_pinned and stories_derive_is_container is guarded by something stronger than a comment (e.g. an automated test reading pg_trigger, or a naming/ordering convention enforced elsewhere) so a future same-table trigger addition can't silently break it
- [x] #3 Migration comments no longer cite specific review-pass provenance (rls-security-reviewer / TASK-189 / /code-review) per CLAUDE.md's Code Comment Policy
- [x] #4 The audit-then-clear block and the #6366f1 default-color literal are defined once and reused by recompute_is_container/create_epic/set_epic_pinned instead of hand-duplicated
- [x] #5 rls-security-reviewer pass plus /code-review before merge (this migration touches TASK-182/TASK-189's remediation surface)
- [x] #6 The boolean expression 'epic_pinned OR has_children' is defined once and reused by derive_is_container's trigger body and recompute_is_container's v_should_be computation, not duplicated verbatim (found by TASK-191's /code-review)
- [x] #7 protect_stories_epic_pinned's blanket role-based exemption (any SECURITY DEFINER function bypasses the guard) is narrowed to an explicit allowlist of the two writer functions, or the gap is explicitly reviewed and accepted as low-risk with a comment explaining why (found by TASK-191's /code-review)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-191's /code-review (2026-07-25) surfaced 2 more findings against this same migration, folded in as AC#6/#7 above: the is_container boolean formula duplicated between derive_is_container and recompute_is_container, and protect_stories_epic_pinned's role-based (not allowlist-based) exemption for SECURITY DEFINER functions -- not exploitable today (verified: update_story isn't SECURITY DEFINER; split_story forces epic_pinned false on insert), but flagged as a forward-looking hardening gap.

Comment-policy violations (AC#3) fixed as a drive-by cleanup during TASK-193's /code-review response (2026-07-26), ahead of this task's own migration work: epic_pinned.sql:58/144, epic-pinned.integration.test.ts (2 spots), set-story-parent.integration.test.ts:176 all had their /code-review, rls-security-reviewer, TASK-189/192 provenance framing stripped, keeping only the actual constraint each comment states. AC#3 can be checked off without further work here. AC#1 (DOWN order), AC#2 (trigger-order fragility), AC#4 (SQL duplication), AC#6/#7 (is_container formula duplication, protect_stories_epic_pinned's role-based exemption) remain — these need a real forward-fixing migration, not just comment edits.

Re-confirmed by TASK-196's /code-review (2026-07-26): DOWN order (AC#1), trigger-order fragility (AC#2), audit-then-clear/#6366f1 duplication (AC#4), and protect_stories_epic_pinned's role-based exemption (AC#7) are all still open. New minor finding folded in: stories_aa_protect_epic_pinned and stories_derive_is_container are BEFORE INSERT OR UPDATE with no WHEN clause, so both run on every stories write (title edits, drag reorders) even when epic_pinned/parent_id are untouched -- a WHEN clause would skip both for ordinary edits. No new AC added (same migration, same fix pass); worth picking up when this task is implemented.

IMPLEMENTED 2026-08-04 in supabase/migrations/20260804072703_epic_pinned_dedupe_helpers.sql (advisor-reviewed before implementation; verdict = approved with corrections).

Three new helpers own what was duplicated: default_epic_color() (immutable), story_should_be_container(uuid, boolean) (stable; takes epic_pinned as a parameter because derive_is_container passes the in-flight NEW value), containerize_story(public.stories, boolean). All three revoke EXECUTE from public/anon/authenticated. Four callers recreated from their CURRENT bodies with only the duplicated parts swapped: derive_is_container, recompute_is_container, set_epic_pinned, create_epic (both exit guards preserved).

Advisor corrections applied: containerize_story is SECURITY INVOKER, not DEFINER — it clears any story's points/state/iteration with no authorization of its own, so definer would leave the revoke as the only barrier; both callers are already definer so it runs as owner there anyway. No CASE expression needed (epic_pinned = epic_pinned or p_pin in one statement). set_config set/reset pair lives inside the helper, since a missed reset mislabels the rest of the transaction as bookkeeping.

AC#1: the DOWN block of 20260724181957_epic_pinned.sql was reordered IN PLACE (lines 335-348), not restated in the new migration. Advisor's reasoning: an operator walks DOWN blocks newest-first, so a correction written in the new file would never be read at the point the old recipe is followed. Precedent exists — AC#3's comment-policy fix was applied in place in the same file. The new migration's own DOWN block avoids the same trap (restore the four bodies, THEN drop the three helpers).

AC#2: apps/web/lib/utils/epic-pinned.integration.test.ts asserts stories_aa_protect_epic_pinned sorts first among BEFORE ROW triggers on stories (tgtype & 3 = 3, not tgisinternal). No new audit RPC was needed — that file already opens a raw pg Client.

AC#7: CLOSED AS ACCEPTED, per the AC's second option, plus a tripwire. The GUC self-declaration alternative was rejected by the advisor for a reason stronger than the one in the plan: protect_stories_epic_pinned runs on EVERY stories write, so refusing undeclared owner-role writes would break every backend path, not just epic_pinned ones. Inside a SECURITY DEFINER function current_user is indistinguishable from a migration's, so an allowlist of callers is not expressible. The existing comment at 20260724181957:56-61 already documents the gap, so no new comment was added; instead a second test asserts the set of public functions whose prosrc mentions epic_pinned equals a 9-name allowlist, so a future definer writer fails in development. Known blind spot recorded in the test: a body carrying the column without naming it (insert ... select) is not caught.

The tripwire immediately earned itself — it found a 9th function the advisor's list of 8 missed: set_story_parent, which matches on a comment naming set_epic_pinned rather than on any write. Listed with that noted rather than filtered out.

TASK-196's WHEN-clause finding: WON'T-DO, and the reason is safety rather than performance. when (new.epic_pinned) would skip the UPDATE where a client tries to unpin (new=false, old=true), so the reset to old.epic_pinned never runs and a raw PATCH could un-epic a story — reopening TASK-182's hole. The correct predicate (new.epic_pinned or old.epic_pinned) is unwritable in a single insert-or-update trigger since INSERT has no OLD, and splitting the trigger doubles the name-ordering surface AC#2 just fenced. Also, derive_is_container running unconditionally self-heals a drifted is_container on any write; a WHEN clause removes that too.

Verification: SUPABASE_INTEGRATION=1 pnpm test full suite 144 files / 1302 tests green (+2 new), lint + tsc clean. Advisor-specified five (epic-pinned, nesting, grant-lockdown integration + activity page + burndown) green individually. Applied with 'supabase migration up' rather than 'db reset' — the local DB holds other sessions' data. rls-security-reviewer pass: no issues found (confirmed the composite-type revoke signature resolves, the invoker choice is safe under nested-SECURITY-DEFINER current_user semantics, both exit guards intact, no path exits between set_config and its reset).

AC#5 IS NOW COMPLETE: the rls-security-reviewer half was already done and clean, and /code-review high ran 2026-08-04. Its findings against this migration are below.

/code-review high (2026-08-04) FINDINGS FIXED — two of the ten landed on this migration, both comment-only (the SQL was found faithful: every recreated body matches its true latest source, no later migration silently reverted, every guard, exit guard and advisory lock preserved):

1. containerize_story's header comment was wrong in a way that invited deleting a load-bearing guard. It claimed 'both callers guard on the same condition ... so the audit row is written iff the story was not already a container', but only recompute_is_container pre-checks. set_epic_pinned reaches containerize_story(v_row, true) for a story that is ALREADY a container through child membership: is_container true with epic_pinned false passes its idempotence comparison (verified by reading the body). So the internal `if not p_row.is_container` is the only thing preventing a phantom story.containerized row with old_points already null — the exact duplicate-log class TASK-225 was filed to remove. The comment now says the guard exists because one caller does not pre-check.

2. Comment-policy violation in the DOWN block: '(NOT 20260724181957, which predates the exit guard TASK-223 added)'. The which-body-to-restore pointer is load-bearing and stayed; the task id went.
<!-- SECTION:NOTES:END -->
