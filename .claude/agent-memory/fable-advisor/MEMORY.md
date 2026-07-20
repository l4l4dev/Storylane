# Memory Index

Fable-era advisor handoff (written 2026-07-18 for the Opus successor).

- [Review sharp edges](review-sharp-edges.md) — traps to check first: rollover/finalize-once, advisory lock, RLS pitfalls, position invariant, IME guard, decision-1
- [doc-8 locked decisions](doc8-locked-decisions.md) — 2026-07-18 concept redesign: each decision's WHY; do not relitigate (Icebox=NULL, immutable category, capacity snapshot, ratio of sums, ...)
- [Owner review preferences](owner-review-preferences.md) — usability first (rework cost not a constraint), Pivotal parity unless spec records divergence, findings hold merge, public repo
- [Review checklists](review-checklists.md) — run for (a) migration diffs and (b) board/concurrency changes before any verdict
- [Approved parity divergences](approved-parity-divergences.md) — TASK-80 Estimate popover & doc-8 board-level state controls are deliberate; don't re-flag
- [TASK-91 Phase D verdicts](task91-phase-d-verdicts.md) — parity matches; both findings closed (create RPC landed; null-label "dead end" = not user-reachable, don't loosen evaluateDrop)
- [Remaining-chain design decisions](remaining-chain-design-decisions.md) — 2026-07-20 front-loaded designs for 87/82/88/89/93/98: trigger-based cadence log, Focus removal moved into 88, pins = plain RLS writes, transactional signup seeding, dump-based baseline; all owner questions resolved 2026-07-20
