---
id: doc-23
title: >-
  23 — Session handoff 2026-07-28 — hardening chain (TASK-209/210/208 done,
  TASK-211 open in PR #9)
type: other
created_date: '2026-07-28 11:38'
updated_date: '2026-07-28 11:38'
---
# 23 — Session handoff 2026-07-28 — hardening chain (TASK-209/210/208 done, TASK-211 open in PR #9)

## State

`main` is at `b84c8eb`, everything through TASK-208 merged and deployed-ready.
**PR #9 (TASK-211) is open and MUST NOT be merged as it stands** — a sixth Codex
review landed after the owner paused the work and raised two P1s that are both
real (verified). The pause was for time reasons; the block is now technical.

| Task | State |
|---|---|
| TASK-209 MCP epics -> parent_id | Done, merged (`7d4c64c`) |
| TASK-210 Slack webhook SSRF | Done, merged (`f0e5a3b`) |
| TASK-208 board invariants trigger | Done, merged (PR #8, `1c5d43d`) |
| TASK-211 role re-check after lock | **In Progress, PR #9 open** |

## Resuming TASK-211

Branch `fix/recheck-role-after-lock`, 7 commits, PR
https://github.com/l4l4dev/Storylane/pull/9

CI is green on `3c6e56a`, the full web suite is 1173/1173 from a clean reset, and
`rls-security-reviewer` passed twice. But **five findings from Codex round 6 are
open**, two of them P1, so the branch is not finishable without addressing them.

### Open, verified — fix before merging

1. **P1, `move_story_board`'s exit guard is bypassed on two of three exit paths.**
   The `v_zone = 'single'` branches `return;` at lines 373 and 405, before the
   exit guard at 414. Verified by reading the applied function. An anchored
   current-iteration or Icebox move that blocks while shifting a tuple, with the
   caller removed during that wait, still commits. The guard as it stands is
   decorative for those paths — route all three returns through it.

2. **P1, three lock-taking RPCs were never swept:** `finalize_iteration`,
   `override_iteration_length`, `reshape_current_iteration`. They re-check only
   after `iteration_finalize:` (from `20260722000006` / `20260722000010`) and then
   perform several more writes, so the exit-guard rationale applies to them
   identically. They live in migrations already on `main`, so this needs a new
   migration.

3. P2, `remove_member`'s exit guard may reject a legitimate self-demotion while
   another owner remains — needs checking against the last-owner rule.
4. P2, move/copy should revalidate `archived_at` and `point_scale` at exit too,
   not only after the advisory lock.
5. P2, `finish_story_from_git` should revalidate its webhook config after the
   write, on the same reasoning.

### Then

Merge with a merge commit (matching PRs 5-8), delete the branch, set TASK-211
Done, commit that.

An earlier version of this doc claimed the sixth review never arrived and that
nothing was outstanding. Both were wrong — it arrived ~20 minutes later.

## What TASK-211 turned out to be

The task named three membership RPCs. It ended up being ten functions plus a
design reversal, and the reversal is the part worth carrying forward.

The original strategy was "re-check the caller's role after each advisory lock".
Five review rounds showed that strategy is wrong **in principle**, not merely
incomplete: the places a function can block are not enumerable. Beyond advisory
locks there are `select ... for update` on a contended row, ordinary UPDATEs
waiting on tuple locks, INSERTs waiting on foreign-key rows, locks taken by
triggers, and locks taken by functions those triggers CALL
(`maintain_is_container` -> `recompute_is_container` locks the parent row — a
call chain a grep of trigger bodies cannot see).

The final design **guards the exit**: each function re-asserts its guard after
its LAST WRITE. Nothing a PL/pgSQL function writes is durable until commit, so
raising after the last write rolls back everything regardless of what it waited
on. `spec/rls.md` records this and explicitly says not to attempt the
enumeration.

## Carry-forward lessons

- **Rebuild `CREATE OR REPLACE` bodies from the live database, never from the
  migration a task's References name.** Those files go stale. Rebuilding
  `remove_member` from `20260717000001` would have silently reverted its
  `my_work_story_state` purge; same trap for `split_story` and `invite_member`.
- **`perform` sets `FOUND`.** A re-check placed between a `SELECT` and the
  `if not found` reading it silently breaks the existence branch. Hit twice.
- **A guard with no test that fails when it is removed is not evidence.** Most
  Codex findings on PRs #8/#9 were exactly this: correct code, vacuous proof.
  Deleting the guard and re-running is the cheap check, and it caught real gaps
  every time it was applied.
- **`vitest` transpiles without typechecking**, so a green suite can sit on code
  that will not compile. Run everything `web-ci.yml` runs — core tsc, core
  tests, web tsc, web lint, web build — not just tests and lint.
- **`supabase db reset` intermittently fails with `error running container: exit
  1`**, leaving an empty DB and ~100 integration failures. Re-running fixes it;
  it is not a migration problem.

## Next work after TASK-211

By ordinal: TASK-212 (`createDraftStory` partial rows, ord 1200, `@claude-opus-5`),
then TASK-204, TASK-209 is done so TASK-92, TASK-213, TASK-214.

TASK-218 (burndown point-snapshot correctness) is now `m-2`/high/`@claude-opus-5`
at ordinal 2150 — it needs a new migration teaching `log_story_activity` to
record point changes, so it is architecture-sensitive.

## First prompt for the next session

> PR #9 (TASK-211) が未マージで残っています。Codex round 6 の指摘5件(P1 が
> 2件)が未対応なので、マージ前にそれを片付けてください。内容と検証結果は
> backlog doc-23 と TASK-211 のノートにあります。特に P1 の1件目は、私が追加
> した出口ガードが早期 return 2本を迂回しているという指摘で、実際にそうなって
> いることを確認済みです。片付いたら merge commit でマージ、ブランチ削除、
> TASK-211 を Done にして、実装順どおり TASK-212 へ進んでください
> (@claude-opus-5 想定)。
