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
**PR #9 (TASK-211) is open, CI green, and every Codex finding through round 7 is
addressed.** It is unmerged only because the owner paused it; there is no
technical blocker as of the last commit on the branch.

| Task | State |
|---|---|
| TASK-209 MCP epics -> parent_id | Done, merged (`7d4c64c`) |
| TASK-210 Slack webhook SSRF | Done, merged (`f0e5a3b`) |
| TASK-208 board invariants trigger | Done, merged (PR #8, `1c5d43d`) |
| TASK-211 role/exit guards | **In Progress, PR #9 open** |

## TASK-211 as shipped

Eight Codex rounds ran on PR #9: 30 findings, 28 real, 2 rejected with
measurements. The sweep grew from the three RPCs the task named to **sixteen**
functions — ten in `20260728073000`, three iteration RPCs in `20260728120000`,
three story RPCs in `20260728140000`, plus `finish_story_from_git` in
`20260728100000`.

Rounds 5-8 each produced 4-5 findings of one shape: another value read before a
wait, enforced only inside the RPC, stale by the time the write landed. Role,
webhook config, `archived_at` and `point_scale` are closed here. The remaining
three — retained assignee, `reshape_current_iteration`'s `iteration_length`, and
`finish_story_from_git`'s forward-only state positions — went to **TASK-219**,
because "preconditions enforced only in the RPC" is an open set and enumerating
it fails the same way enumerating wait points did. TASK-219 also carries the
seven copies of the point-scale literals across five DB functions.

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

> TASK-211 (PR #9) は 8 ラウンドのレビューを経てマージ済みです。構造的な残件は
> TASK-219 に切り出してあります。実装順どおり TASK-212 (createDraftStory の
> 部分行残留、@claude-opus-5 想定) から進めてください。TASK-211 で学んだこと
> — CREATE OR REPLACE の本体は稼働中DBから取る / perform は FOUND を壊す /
> 削除して落ちないテストは証拠にならない / vitest は型を見ない — は下の
> 「Carry-forward lessons」にあります。
