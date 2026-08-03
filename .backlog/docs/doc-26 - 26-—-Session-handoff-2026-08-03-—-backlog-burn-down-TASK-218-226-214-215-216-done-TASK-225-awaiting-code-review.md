---
id: doc-26
title: >-
  26 — Session handoff 2026-08-03 — backlog burn-down (TASK-218/226/214/215/216
  done, TASK-225 awaiting /code-review)
type: other
created_date: '2026-08-03 05:26'
updated_date: '2026-08-03 05:26'
---
# Session handoff 2026-08-03 — backlog burn-down run

The owner asked for the whole remaining task list to be worked through in a
recommended order. Four tasks landed on `main`; the fifth is committed on a
branch and is the resume point.

## Landed on main

| PR | Task | What it fixed |
|---|---|---|
| #18 | TASK-218 | Burndown replayed today's points over finished sprints. `story.points_changed` added to the trigger; `buildBurndown` rewritten as a rewind-then-replay over category, points and membership. |
| #19 | TASK-226 | `activity_logs.created_at` defaulted to `now()` (transaction start), so two writes to one story could be read back in an order that never happened. Now `clock_timestamp()`. |
| #20 | TASK-214 | Web CI never triggered on `apps/mcp/**` and never ran the Deno Edge Function tests. Both gated now; the stale `/dashboard` E2E assertion fixed. |
| #21 | TASK-215, TASK-216 | The agent-config parity gate compared instruction bodies only and watched only the agent directories. Metadata and symlink checks added, with `check-agent-config-parity.test.sh` (38 cases). |

## In flight — TASK-225

Branch `fix/containerize-bookkeeping-marker`, two commits, pushed. **No PR
yet, and `/code-review` has not run.** That is the one gate still owed; the
owner has to type it (a model cannot start it).

Turning a story into an epic writes four `activity_logs` rows. Filed as feed
noise; it turned out to be four real defects, found in this order:

1. **Slack false positive** (fable-advisor). The outbox trigger fires on any
   `story.state_changed`, and `slack-notify` maps a null `to` to the Icebox —
   so a Slack-connected project announced "moved to the Icebox" on every epic.
   Reproduced against the local DB before fixing.
2. **Unestimated stories left no trace** (`/code-review`). `story.containerized`
   was only written when `points is not null`, while the three rows it was
   meant to speak for were written regardless.
3. **Story-detail history lost it entirely** (`/code-review`). That reader uses
   an action whitelist which never contained `story.containerized`, so hiding
   the three rows removed the last trace.
4. **`set_epic_pinned` was untouched** (rls-security-reviewer, HIGH). That RPC
   is the "Turn into epic" button and carries its own copy of the
   audit-then-clear. It never routes through `recompute_is_container` — the
   trigger fires on `parent_id`, that RPC touches `epic_pinned` — so the
   primary user path was entirely unfixed.

Design decision (AC#1): the three rows are **marked, not suppressed**.
`buildBurndown` rewinds from a story's current row, where an epic has points,
state_id and iteration_id all NULL; those transitions are how it learns the
story held N points and sat in the iteration until that moment. Suppressing
them would make a containerized story read as never having been a member —
AC#3 of this very task. A payload marker rather than a distinct action name,
because `buildBurndown` and `describeActivity` both switch on `action` and a
new name would fall through every case.

Two mistakes worth not repeating:

- The first `set_epic_pinned` copy came from `20260724181957_epic_pinned.sql`
  and silently deleted the TASK-223 exit guard added later in
  `20260728140000_story_rpc_exit_guards.sql`. An existing integration test
  caught it. **Always locate the current definition with
  `grep -ln "function public.<name>" supabase/migrations/*.sql | tail -1`
  before copying a function body.** The DOWN block now spells this out.
- Making the `story.containerized` insert unconditional widened an existing
  failure: `actor_id` is NOT NULL and the insert used a bare `auth.uid()`, so
  a caller without one (service role, a DB job) aborted the whole
  containerization. Now `coalesce(auth.uid(), v_row.created_by)`.

Reviews so far: fable-advisor (approved with corrections, all applied),
`/code-review high` (4 findings, all fixed), rls-security-reviewer twice — the
second pass verified by diff that the exit guard survived and found only the
DOWN-block omission, already fixed.

State: 902 unit tests, 79 integration tests across the epic/activity_logs
suites, lint and tsc clean. Every new integration case was confirmed to fail
with its fix reverted.

## Next

1. Owner runs `/code-review high` on the branch. Address findings, then open
   a PR (migration + concurrency ⇒ PR, not a direct push).
2. **TASK-224** — blocked on an owner ruling, which is its own AC#1: does
   `spec/screens.md`'s "state/assignment events" mean assignee changes should
   produce an activity row? Only extend the trigger if the answer is yes;
   otherwise clarify the spec wording so the question stops recurring.
3. Then TASK-195 (epic_pinned migration review findings), TASK-30 (DB-level
   read-only for archived projects — new RLS, needs `/advisor`), and finally
   TASK-98's **local** half (squash + `db reset` + docs), deliberately placed
   last so the migration-adding tasks above do not force a re-squash.

Deferred by owner decision this session: TASK-217 (responsive / a11y /
performance audit) — open-ended and the place human eyes matter most.

Owner-only and unchanged: TASK-94 (production verification, and it gates
TASK-98's production half), TASK-49, TASK-92.

Filed this session: TASK-227 (E2E never runs in CI), TASK-228 (invite-search
integration test crowded out by its own leftovers).

## Environment

- Local Supabase is running with every migration applied, including the
  unmerged `20260803000000`. A fresh clone of `main` will NOT have it — apply
  the branch before running the epic integration suites.
- `POINTS_HISTORY_FROM` in `apps/web/lib/utils/burndown.ts` ships as
  `2026-08-02` and must be raised to the real production apply date if the
  deploy lands later. Tracked as TASK-94 AC#3.
- Neither PR #18 nor #19 is deployed. Production needs `supabase db push` in
  addition to the app deploy.
- `invite-search.integration.test.ts` fails in a full local
  `SUPABASE_INTEGRATION=1` run on a dev database carrying old test users. It
  passes in isolation and on CI's empty database — that is TASK-228, not a
  regression.
