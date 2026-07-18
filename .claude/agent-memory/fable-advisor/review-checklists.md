---
name: review-checklists
description: Advisor checklists for (a) migration diffs and (b) board/concurrency changes in Storylane
metadata:
  type: project
---

Written 2026-07-18 by the Fable-era advisor for its successor. Run these before writing
a verdict; each item traces to [[review-sharp-edges]] / [[doc8-locked-decisions]].

## (a) Migration diff checklist

1. RLS enabled on every new table + FULL policy set (SELECT/INSERT/UPDATE/DELETE as
   applicable) + `GRANT` to the right roles. Policies are never inherited.
2. RETURNING paths: does every RPC/insert that returns a row have SELECT visibility on
   that row under the caller's policies?
3. SECURITY DEFINER? Then membership re-checked for EVERY project the function touches
   (source AND destination for move; per-pinner for pin recreation). Prefer SECURITY
   INVOKER when one project suffices.
4. Cross-project reference possible? Child FK must be composite `(id, project_id)`.
5. Positioned table? `position` defaults from the correct sequence + DEFERRABLE
   INITIALLY DEFERRED unique (spec/data-model.md "Position ordering invariant").
6. Touches iterations or per-project invariants? `pg_advisory_xact_lock(project id)` +
   reject writes when iteration `state='done'` (spec/velocity.md "Finalization
   concurrency & permissions").
7. Numbering trigger: any story row movement must be insert+delete, never
   `UPDATE project_id`.
8. Business rules in an RPC, not only in a server action (decision-1 — iOS has no
   server actions). Sequential migration numbering; no data migration assumed pre-launch
   only where doc-8 already granted it.

## (b) Board / concurrency change checklist

1. Which invariant guards the write: done-iteration guard? estimation gate? `FOR UPDATE`
   on the story row (cf. transition_story race fix, TASK-48)? Name it or reject.
2. Two tabs / two members racing on the same project — what happens? If the answer needs
   read-then-write across rows, it needs the advisory lock or row locks.
3. Autosave/inline edit: conflict rules per spec/screens.md "Conflict & failure rules
   (2026-07-08)"; keyboard handlers guard `event.isComposing` (IME) with a test firing
   `isComposing: true`.
4. Open bugs TASK-19..23 (ordering/filter/error-handling): does the plan account for
   them, or rebuild the same code and reintroduce them? Check current task states first.
5. Write model = TASK-70 (a): any member operates any story — don't approve assignee-only
   restrictions.
6. Pure planning/state math (advance-button, virtual groups, rate) stays a per-client
   pure function with shared golden fixtures updated web + iOS together (decision-1,
   doc-8 §2/§7).
7. Pivotal parity: divergence must already be recorded in spec (ux-principles.md), else
   flag as accidental divergence.
