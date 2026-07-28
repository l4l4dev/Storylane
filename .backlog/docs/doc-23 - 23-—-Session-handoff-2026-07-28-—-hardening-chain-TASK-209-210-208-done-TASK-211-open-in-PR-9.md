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
**PR #9 (TASK-211) is open, CI green, and deliberately NOT merged** — the owner
paused it for time reasons, not because anything is wrong with it.

| Task | State |
|---|---|
| TASK-209 MCP epics -> parent_id | Done, merged (`7d4c64c`) |
| TASK-210 Slack webhook SSRF | Done, merged (`f0e5a3b`) |
| TASK-208 board invariants trigger | Done, merged (PR #8, `1c5d43d`) |
| TASK-211 role re-check after lock | **In Progress, PR #9 open** |

## Resuming TASK-211

Branch `fix/recheck-role-after-lock`, 7 commits, PR
https://github.com/l4l4dev/Storylane/pull/9

Nothing is outstanding. CI is green on `3c6e56a`, the full web suite is
1173/1173 from a clean reset, `rls-security-reviewer` passed twice, and all 17
Codex findings on this PR are addressed. The only reason it is unmerged is that
the owner stepped away.

**To finish it:** confirm CI is still green, merge with a merge commit (matching
PRs 5-8), delete the branch, then set TASK-211 to Done and commit that.

A sixth `@codex review` was requested and never arrived — Codex is out of quota.
That review is optional; the five that did run are recorded in the task notes.

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

> PR #9 (TASK-211) が CI green で未マージのまま残っています。状態を確認して、
> 問題なければ merge commit でマージ、ブランチ削除、TASK-211 を Done にして
> ください。詳細は backlog doc-23 にあります。そのあと実装順どおり TASK-212
> に進んでください(@claude-opus-5 想定)。
