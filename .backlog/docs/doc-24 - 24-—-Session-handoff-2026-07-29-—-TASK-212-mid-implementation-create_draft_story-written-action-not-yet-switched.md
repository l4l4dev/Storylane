---
id: doc-24
title: >-
  24 — Session handoff 2026-07-29 — TASK-212 mid-implementation
  (create_draft_story written, action not yet switched)
type: other
created_date: '2026-07-29 04:35'
updated_date: '2026-07-29 04:35'
---
# 24 — Session handoff 2026-07-29 — TASK-212 mid-implementation (create_draft_story written, action not yet switched)

## State

`main` is at `610f084`. TASK-209, 210, 208 and 211 are all merged and Done.

TASK-212 is **In Progress on branch `fix/create-draft-story-atomic`** (`origin` has
it). The RPC is written, applied locally, and verified; the server action still
runs the old three-step path, so the RPC is not called yet. No PR opened.

## What is done

`supabase/migrations/20260729050000_create_draft_story.sql` — one RPC doing
insert + labels + points check + position in a single transaction.

Verified against a live DB:

| check | result |
|---|---|
| all three targets (`backlog` / `unstarted` / `icebox`) | work |
| foreign-project label (AC #1) | `42501`, row count unchanged — **no orphan** |
| valid label | attaches |
| `unstarted` with no iteration | still raises `No active iteration` |

The original bug was reproduced first: forcing `update_story` to fail with a
foreign-project label left a title-only story behind, and a retry would have made
a second one.

## Two wrong turns worth not repeating

**`SECURITY DEFINER` silently removed the label guard.** Written DEFINER first,
and the foreign label was *accepted*. The cross-project guard is an RLS `WITH
CHECK` on `story_labels`, and DEFINER bypasses RLS — so the design's premise
("`WITH CHECK` rejects it, no pre-validation needed") stopped holding the moment
the function became DEFINER. That premise is correct for `create_story_tracker`,
which is INVOKER.

**INVOKER cannot call `require_project_role`.** It is revoked from
`authenticated`; it exists for DEFINER callers, which is why `insert_board_item`
is DEFINER. `create_story_tracker` calls no role helper at all and delegates to
RLS. `create_draft_story` matches that.

**Consequence for TASK-211's rule:** an INVOKER function needs no exit guard,
because RLS re-evaluates per statement as the caller, including after a wait. The
exit-guard convention in `spec/rls.md` exists because DEFINER suppresses that.
Recorded in the migration header so the absence does not read as an oversight.

## Remaining work

1. **`apps/web/app/projects/[id]/board/actions.ts`** — `createDraftStory` becomes
   one `create_draft_story` call per target. Delete the `unstarted`
   pre-resolution block (lines ~135-152) and the best-effort reposition block
   (~165-178). The reposition error then propagates, which is **AC #2**.
2. **Rewrite the eleven unit cases** in `actions.test.ts` from line ~416. Most
   assert the old internal shape — that `insert_board_item` is called for
   `backlog` and not a plain insert, that `move_story_board` is called with a
   particular view, that `update_story` applies the field set. All of that is
   gone.
3. **Integration coverage**: the orphan case, the reposition error propagating,
   and `unstarted` refusing to land in an iteration finalized during the wait.
   Reuse the lock-holding harness in
   `apps/web/lib/utils/role-recheck-after-lock.integration.test.ts`.
4. `rls-security-reviewer` on the migration (CLAUDE.md requires it), then ask the
   owner to run `/code-review high`, then PR.

## Carry-forward habits from TASK-211

These earned their place over eight review rounds and 30 findings:

- **A guard with no test that fails when it is removed is not evidence.** Delete
  the guard, re-run, confirm it breaks. It caught something every time.
- **Rebuild `CREATE OR REPLACE` bodies from the live database**, never from the
  migration a task's References name — those go stale and rebuilding from them
  silently reverts shipped behaviour.
- **`perform` sets `FOUND`**, so it cannot sit between a query and the
  `if not found` reading it.
- **`vitest` transpiles without typechecking.** Run everything `web-ci.yml` runs
  — core tsc, core tests, web tsc, web lint, web build — not just tests and lint.
- **`supabase db reset` intermittently fails** with `error running container: exit
  1`, leaving an empty DB and ~100 failures. Re-run it; not a migration problem.

## Next after TASK-212

By ordinal: TASK-219 (1225, the precondition-staleness design filed from
TASK-211's review), then TASK-204, TASK-92, TASK-213, TASK-214.
