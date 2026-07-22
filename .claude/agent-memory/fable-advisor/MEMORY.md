# Memory Index

Fable-era advisor handoff (written 2026-07-18 for the Opus successor).

- [Review sharp edges](review-sharp-edges.md) — traps to check first: rollover/finalize-once, advisory lock, RLS pitfalls, position invariant, IME guard, decision-1
- [doc-8 locked decisions](doc8-locked-decisions.md) — 2026-07-18 concept redesign: each decision's WHY; do not relitigate (Icebox=NULL, immutable category, capacity snapshot, ratio of sums, ...)
- [Owner review preferences](owner-review-preferences.md) — usability first (rework cost not a constraint), Pivotal parity unless spec records divergence, findings hold merge, public repo
- [Review checklists](review-checklists.md) — run for (a) migration diffs and (b) board/concurrency changes before any verdict
- [Approved parity divergences](approved-parity-divergences.md) — TASK-80 Estimate popover & doc-8 board-level state controls are deliberate; don't re-flag
- [TASK-91 Phase D verdicts](task91-phase-d-verdicts.md) — parity matches; both findings closed (create RPC landed; null-label "dead end" = not user-reachable, don't loosen evaluateDrop)
- [Remaining-chain design decisions](remaining-chain-design-decisions.md) — 2026-07-20 front-loaded designs for 87/82/88/89/93/98: trigger-based cadence log, Focus removal moved into 88, pins = plain RLS writes, transactional signup seeding, dump-based baseline; all owner questions resolved 2026-07-20
- [doc-12 My Work / nav review](doc12-my-work-nav-review.md) — 2026-07-21 pre-implementation review: Done section must render last not first (principle 9), rollover-for-all-projects reuses dashboard's existing pattern, completed_at index claim was wrong
- [TASK-108 My Work color contrast defect](project-my-work-color-contrast.md) — approve-with-fixes; badge text using raw project-accent hue fails WCAG contrast for several palette slots, recheck if the sidebar/dashboard ever reuse project-color.ts as text (not just border/background)
- [doc-15 My Work redesign verdict](doc15-my-work-redesign-verdict.md) — 2026-07-22 approve-with-fixes: composite FK for column_id, invoker not definer, forward-only mapping drop, client-local Today date, dead-card cell excluded
- [Silent no-op writes violate principle 2](learnings-silent-noop-actions.md) — a server action returning ok:true but with no visible effect is a principle-2 defect, not just a "successful write"
- [Additive/log-style lists need per-card dormant markers](learnings-additive-log-lists-need-markers.md) — when the same entity can appear in both a live column and a log/history column, column position alone isn't enough for principle 9
- [My Work column management (TASK-141)](project-my-work-column-management.md) — doc-15 free-column panel, mirrors state-manager.tsx, approved-with-changes 2026-07-22
- [Full-array reorder race check](learnings-full-array-reorder-race.md) — check button-reorder panels: does a pending save block ALL rows, or just the one moving? Full-array-overwrite patterns can silently lose concurrent edits
- [Touch fallback must be touch-sized](learnings-touch-fallback-must-be-touch-sized.md) — a control justified FOR touch/a11y must have a touch-sized hit target, not inherit icon-xs mouse density (principle 7)
- [TASK-147 personal-project seal verdict](task147-personal-project-seal-verdict.md) — approve-with-changes; move/copy-target exclusion reopens doc-11 D1's locked "don't re-flag" decision, needs owner sign-off + RPC-level guard not just UI hide
- [revalidatePath empties derived props](learnings-revalidate-empties-derived-props.md) — a memo'd server prop (staleToday etc.) can go empty mid-action once revalidatePath lands; freeze ids/count into local state for any undo/confirm affordance that must outlive its own mutation
