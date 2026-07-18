---
name: review-sharp-edges
description: Recurring traps to check FIRST in any Storylane review — rollover/finalize, advisory lock, RLS pitfalls, position invariant, IME guard, decision-1
metadata:
  type: project
---

Written 2026-07-18 by the Fable-era advisor for its successor. These are the traps that
have actually bitten this repo, verified against spec anchors on that date.

- **Lazy rollover / finalize-once** — `spec/velocity.md` "Rollover (lazy, on first access
  after end_date)" + "Finalization concurrency & permissions (2026-07-08)". Iterations
  finalize exactly once; writes into `state='done'` iterations are guarded. Any plan that
  "just recomputes" a past iteration or writes into it is a rejection.
- **`pg_advisory_xact_lock` keyed on project id** — the finalization RPC pattern. Any NEW
  RPC that reads-then-writes iteration rows, creates iteration rows (catch-up), overrides
  sprint length, or enforces per-project invariants (e.g. ≥1 unstarted/done state trigger)
  must take the same lock. Ask "can two callers race on this project?" before approving.
- **RLS pitfalls seen repeatedly here** (also [[learnings-supabase-rls]] in the user's
  auto-memory, `spec/rls.md`):
  - Missing `GRANT` — a policy without a table/function grant silently 401s.
  - `RETURNING` visibility — INSERT/UPDATE ... RETURNING fails if SELECT policy doesn't
    cover the new row; check every RPC that returns the row it wrote.
  - SECURITY DEFINER RPCs bypass RLS entirely → must re-check membership in EVERY project
    they touch (move_story_to_project touches two; pin recreation touches destination).
  - Composite FK `(id, project_id)` is the mechanism blocking cross-project references
    (stories.state_id, epics, etc.) — a plain FK on a new child table is a finding.
  - Policies are never inherited — every new table needs its own full policy set + grants.
- **Position ordering invariant** — `spec/data-model.md` "Position ordering invariant":
  every INSERT into a positioned table takes `position` from that table's sequence
  (backlog_dividers shares `stories_position_seq`); unique indexes are DEFERRABLE
  INITIALLY DEFERRED. A migration adding a positioned table without sequence default +
  deferrable unique is incomplete. TASK-71 hardening relates.
- **Move/Copy** — `spec/features.md` "Move / Copy to another project (2026-07-07)":
  insert-into-target + delete, NEVER `UPDATE project_id` — the numbering trigger pins
  `number` on UPDATE. Lands at bottom of target backlog.
- **Autosave conflicts** — `spec/screens.md` "Conflict & failure rules (2026-07-08)".
- **IME composition guard** — every keyboard handler (Enter/Escape) checks
  `event.isComposing` (see `apps/web/components/features/board/story-peek.tsx`); tests
  fire keyDown with `isComposing: true`. New keyboard UI without this = finding.
- **decision-1** (`.backlog/decisions/`) — mutations with business rules go in Postgres
  RPCs (server actions don't cover iOS); invariants live in the DB; pure planning/state
  math is per-client (packages/core + iOS) with SHARED GOLDEN FIXTURES. A plan putting
  business rules only in a Next.js server action contradicts it.
- **Open board bugs** — check TASK-19..23 status before approving any plan that rebuilds
  board ordering/filter/error-handling; don't let a rewrite reintroduce them.

See [[doc8-locked-decisions]] for the 2026-07-18 concept redesign and
[[owner-review-preferences]] + [[review-checklists]].
