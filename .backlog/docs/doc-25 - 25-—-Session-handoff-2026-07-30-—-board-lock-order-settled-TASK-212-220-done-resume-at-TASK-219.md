---
id: doc-25
title: >-
  25 — Session handoff 2026-07-30 — board lock order settled (TASK-212/220
  done), resume at TASK-219
type: other
created_date: '2026-07-30 02:20'
updated_date: '2026-07-30 02:21'
---
# Session handoff 2026-07-30

Written at the end of the session that finished TASK-212 and TASK-220. Everything
below is on `main`; nothing is left uncommitted.

## Current state

**TASK-212 — createDraftStory partial rows (Done, PR #10, merge `2d23ff9`)**

Quick-add is one transaction now: `create_draft_story` (`20260729050000`), a
SECURITY INVOKER wrapper that inserts the title and delegates fields to
`update_story` and positioning to `move_story_board`. A failure at any step rolls
the whole creation back, and the reposition error reaches the caller.

Two things about it that must not be "simplified" later:

- INVOKER is load-bearing. The cross-project label guard is an RLS WITH CHECK on
  `story_labels`, which DEFINER bypasses silently.
- It still needs entry AND exit role guards. `update_story`'s writes are an UPDATE
  and a DELETE, which under RLS match zero rows and raise NOTHING for a caller
  demoted mid-transaction.

**TASK-220 — board lock order (Done, PR #11, merge `e311495`)**

The invariant is now uniform across the repo: **every advisory lock is acquired
before any story row lock.** Three migrations got there:

| migration | function | change |
| --- | --- | --- |
| `20260729090000` | `set_story_state` | `iteration_finalize` above the row lock |
| `20260730000000` | `split_story` | `positions` + `story_number` above the locked read |
| `20260730010000` | `move_story_to_project`, `copy_story_to_project` | `story_number:<target>` above the locked read |

`20260730000000`'s header is where the invariant is stated; `create_draft_story`'s
inline comment points at it.

Because each lock key is derived from the story, each of those functions now has an
unlocked probe read for `project_id` followed by a gate, then the locks, then the
authoritative read. In the SECURITY DEFINER ones the probe is NOT RLS-filtered, so
the gate is what stops it being an existence oracle and what stops a non-member
parking a project-wide lock — every gate raise is byte-identical to the
authoritative read's own rejection.

## Things a future session would otherwise re-derive

- **A two-RPC race cannot test lock ordering.** It is decided by whoever wins the
  row and passes against an inverted body. Assert the observable property instead:
  while the advisory lock is held by a third session, is the story row still
  lockable (`for update nowait`)? Harnesses in
  `apps/web/lib/utils/{set-story-state,split-story,move-copy}-lock-order.integration.test.ts`.
- **`SUPABASE_INTEGRATION=1 pnpm test` is the real suite.** Without the flag the
  integration files are skipped: 94 files / 858 tests instead of 138 / 1210. A
  failing integration suite went unnoticed for two review rounds this session
  because of it. Never claim a green suite on DB work without the flag.
- **A viewer does not exercise a non-member path.** A viewer still has a
  `project_members` row, so it only hits "role outside the list". `project_role`
  returns NULL for a non-member and `NULL = any(...)` is NULL, which `if` reads as
  false, so a guard written without an `is null` test lets a non-member through
  while every viewer test stays green. Any new role gate needs a second user.
- **`stories.project_id` has no trigger pinning it.** What actually holds it still
  is `activity_logs_story_project_fk` (`20260715000006`), a composite FK on
  `(story_id, project_id)`. A direct PostgREST PATCH is refused with 23503.
- **Behaviour change shipped deliberately:** a caller de-membered from the SOURCE
  while parked on a lock is now rejected by the locked read's membership subquery
  (`Story not found`) rather than by `require_project_role` (42501), because the
  authoritative read moved below the lock. The target side still raises 42501.
  Restoring the old code would mean two authorization sites whose messages drift.

## Next work: TASK-219

`Re-derive RPC preconditions after the last wait, not per-value at the exit`
(High, bug, `m-2`, `@claude-opus-5`, ordinal 1225). Read it with
`backlog task view TASK-219 --plain` — it carries the full history of why
per-value exit checks did not converge across Codex rounds 5-8.

It needs a DESIGN DECISION before any code: re-derive the inputs after the last
wait, or serialise these RPCs against settings changes with a broader lock. Take
it to `/advisor` first (CLAUDE.md requires that for concurrency-sensitive work),
and update `spec/rls.md` "Guard the EXIT of a SECURITY DEFINER RPC" with whichever
wins.

Two notes from this session that change its starting picture:

1. **The pre-lock probe/gate pattern is now in five functions**, so the set of
   "values read before a wait" grew rather than shrank. `move_story_to_project` and
   `copy_story_to_project` in particular read `archived_at` for both projects and
   the target role BEFORE the lock and re-read them after — they are the closest
   thing the codebase has to a worked example of the per-value approach TASK-219
   wants to replace. Read `20260730010000` before designing.
2. **AC #4's point-scale literals moved.** The seven copies are still in five live
   functions (`assert_points_on_scale`, `update_story`, `split_story`,
   `move_story_to_project`, `copy_story_to_project`), but the newest copies of the
   last three now live in `20260730000000` and `20260730010000`, not the older
   migrations. Verify with:
   `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) like '%0, 1, 2, 3, 5, 8, 13%';`

## Environment

- Local Supabase is running and was rebuilt from the whole migration chain
  (`supabase db reset`) at the end of this session. If it is stopped, run
  `supabase start` then `supabase db reset`.
- Full verification used here: `cd apps/web && SUPABASE_INTEGRATION=1 pnpm test`
  (138 files / 1210 passed), plus `pnpm exec tsc --noEmit` and `pnpm run lint`.
- Applying a single migration to the running DB without a full reset:
  `docker exec -i supabase_db_Storylane psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<file>.sql`
- `gh pr merge` is blocked by the permission classifier in this harness. The owner
  runs it (`! gh pr merge <N> --merge`). `git push`, `gh pr create` and
  `gh pr comment` all work.
- Codex reviews a PR automatically when it is OPENED, but not on later pushes to an
  open PR — comment `@codex review` after each round of fixes.
