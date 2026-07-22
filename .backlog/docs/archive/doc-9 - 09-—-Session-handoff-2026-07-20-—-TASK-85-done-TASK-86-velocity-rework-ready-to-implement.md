---
id: doc-9
title: >-
  09 — Session handoff 2026-07-20 — TASK-85 done, TASK-86 velocity rework ready
  to implement
type: other
created_date: '2026-07-20 01:07'
updated_date: '2026-07-22 09:04'
---
## Current state

**TASK-85 (working-day calendar) is Done and merged to local `main`.** Branch
`feat/working-day-calendar` was fast-forwarded into `main`; `feat/velocity-rework`
is branched off it and checked out, empty so far.

Shipped in TASK-85:

- `supabase/migrations/20260720000001_working_day_calendar.sql` —
  `projects.working_weekdays int[]` (ISO 1–7; CHECK bounds the range **and**
  requires ≥1 day), `project_calendar_exceptions` (holiday / extra_workday, one
  per project-date, members read / owner+member write, `project_id` immutable via
  a reject trigger), `user_time_off` (per-user, cross-project, dates+kind only,
  READ self-or-`shares_project_with`, WRITE self-only).
- Settings UI: project settings "Calendar" section (`WorkingDaysSettings`) and
  account settings "Time off" section (`TimeOffSettings`). Weekdays are
  owner-only (matching `projects` UPDATE RLS) while exceptions accept member
  writes — two separate permission props, not one.
- `formatDate` bug fix: it parsed `YYYY-MM-DD` as UTC midnight and read it back
  with local getters, rendering every calendar date **one day early west of
  UTC**. Now formatted from the digits. This also corrected iteration start/end
  dates on the iterations page and board. Regression test pins it under
  `TZ=America/Los_Angeles`.
- `writeErrorMessage` (`lib/utils/write-error.ts`): maps an RLS refusal (42501)
  to a plain message instead of leaking Postgres policy text.

Verification at the merge commit: **76 test files / 595 tests** pass with
`SUPABASE_INTEGRATION=1`, `pnpm run lint` clean, `pnpm run build` succeeds,
`supabase db reset` applies every migration from empty. Run all of these from
`apps/web/`, not the repo root.

Reviews all passed: `rls-security-reviewer` (one finding fixed — the re-parent
guard), fable-advisor design review (5 findings fixed), `/code-review high`
(8 findings; 1/2/3/5 + the accessibility one fixed, see "Deferred" below).

**Browser verification has NOT been done** for TASK-85. That is the established
practice here (deferred to TASK-94), not an oversight.

## Open decisions — need the owner, do not act unilaterally

1. **Pushing `main` deploys to production.** `.github/workflows/deploy.yml`
   triggers on push to `main` and runs `supabase db push`. `main` currently has
   **9 unpushed commits** (7 from this session, 2 from a concurrent session:
   `5da9511`, `ea03e9e`). Pushing applies the TASK-85 migration to the
   production database. Note **TASK-98** (squash migrations into one baseline +
   full production reset) is still To Do — pushing now means this migration
   lands in production history before that squash.
2. **`.claude/settings.json` was modified by someone else**, not by this
   session: `"ui-ux-pro-max@ui-ux-pro-max-skill"` flipped `true` → `false`. Left
   uncommitted. Decide whether that was deliberate (commit it) or accidental
   (revert it).
3. **`apps/web/.claude/` is untracked and now redundant.** Its two
   fable-advisor memory files were merged into the tracked root store in
   `65c2108`. It should be deleted, but it is untracked, so deletion is not
   recoverable via git — get explicit approval first.

## Deferred review findings (recorded, not bugs blocking anything)

From `/code-review high` on TASK-85, still open:

- `shares_project_with` is evaluated **per row** in the `user_time_off` SELECT
  policy. A 10-member, 14-day capacity read is up to 140 executions of a
  `project_members` self-join. It mirrors the existing `profiles` policy so it
  is consistent, not novel — **measure this during TASK-86**, since TASK-86's
  capacity queries are what amplify it.

Closed as not-a-bug this session (do not reopen without reading the analysis):

- The "null `action_label` drag dead-end" recorded in the fable-advisor memory
  `task91-phase-d-verdicts` was re-measured and is **not user-reachable**: the
  Kanban view has no Backlog column (`spec/screens.md` "Board layout"), the List
  view routes through `evaluateListDrop` whose Backlog→Current is
  unconditional, and Kanban state→state is any→any. The strict branch in
  `evaluateDrop` runs **only** in `dropStory`'s server-side re-validation of a
  concurrently-unscheduled story, where rejecting is the correct conflict guard.
  A comment at that branch (`3ee9847`) records this so a third session does not
  re-derive it.

## Next work: TASK-86 (velocity rework)

Status: **In Progress**, assignee `@claude-opus-4-8`. The full
**advisor-approved implementation plan is recorded on the task itself** — read
it with `backlog task view 86 --plain` and follow it; do not re-derive the
design.

The three design questions were already decided by fable-advisor:

- **(a)** Both a SQL and a TS implementation of the capacity formula, cross-checked
  against **one shared fixture** (`spec/fixtures/capacity.json`), the same pattern
  `spec/fixtures/state-templates.json` already uses. Passing a client-computed
  capacity into the RPC was **rejected** — `finalize_iteration` is the single
  finalization path reached by lazy rollover from any client and from Edge
  Functions, so the invariant must live in the DB.
- **(b)** **No backfill.** Fabricating past capacity from today's membership is the
  retroactive recomputation doc-8 §7 forbids. The empty window is absorbed by the
  existing "minimum 1 point per group" fallback. Accept and document the
  temporary regression.
- **(c)** `iterations.velocity` **keeps its name and meaning** (done-category point
  sum). The rate's numerator is the **sum of snapshotted `velocity` values** —
  never a re-aggregation of `stories`, which would let editing a finished story's
  points move history.

**The correction that matters most** (this is what AC#2 is actually testing):
the finalize loop inserts a new iteration, re-reads it as `v_latest`, and
finalizes it **in the same call** (verified in
`20260719000010_reanchor_finalize_iteration.sql` lines 115–150). A neglected
project therefore generates and finalizes a chain of empty gap rows in one
call. Only the `v_first` pass may write a real capacity; **every later pass
writes `capacity = 0`** — otherwise those rows enter the rate window with
`capacity > 0` and `points = 0` and crush the rate.

Other corrections captured in the task plan: compute capacity from
`v_latest.end_date` **after** the manual-finish truncation; no `joined_at`
proration (finalize-time member set × every working day of the sprint);
`working_weekdays` must be treated as a **set** in both implementations
(TASK-85's CHECK cannot reject duplicates) with a duplicate case in the
fixture; and update **all** consumers of `calculateVelocity`, which include
`apps/web/app/dashboard/actions.ts`, `dashboard/page.tsx` and
`projects/[id]/settings/actions.ts`, not just the board.

## Environment

- Local Supabase is running (Docker/OrbStack). If not: `open -a OrbStack`, then
  `supabase start`.
- Integration tests need `SUPABASE_INTEGRATION=1` and a running local Supabase;
  they read `.env.local` for `NEXT_PUBLIC_SUPABASE_URL`, `_ANON_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Run `pnpm test` / `pnpm run lint` from `apps/web/`** — the root
  `package.json` is workspace config only and exits 1.
- Known noise, not your bug: 3 pre-existing `tsc` errors in
  `lib/utils/project-states.integration.test.ts` (from the TASK-91 commit;
  `lint` is eslint-only so CI does not catch them), and
  `promote.integration.test.ts` flakes roughly 1 run in 8 with
  `insert_board_item failed: An invalid response was received from the upstream
  server` — a local Kong/PostgREST timeout under parallel load, not an
  assertion failure.
