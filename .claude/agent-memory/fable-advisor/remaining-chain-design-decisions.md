---
name: remaining-chain-design-decisions
description: Fable's 2026-07-20 front-loaded designs for TASK-87/82/88/89/93/98 — plans live on the tasks; this records the WHY and the open owner questions
metadata:
  type: project
---

Written 2026-07-20 by Fable (design front-loading pass, owner-requested "use Fable
while it lasts"). Each task's Implementation Plan field holds the concrete steps;
this file records only judgments a successor should not re-derive or contradict.

- **TASK-87 cadence-change logging is a projects-UPDATE trigger**, not an RPC insert.
  Why: the trigger path covers every write route (web, MCP, iOS) like the existing
  activity recording; an RPC-side insert would silently miss direct settings updates.
  The override RPC validates dates only — boundary math stays calendar-blind except
  the 1-day rule (locked, doc-8 §4).
- **TASK-88 absorbs the Focus-view code removal** (was ambiguously split with TASK-89).
  Why: 88 drops `stories.focus`; leaving focus-board.tsx compiled against a dropped
  column would break the build mid-chain, and 88's own AC#2 demands zero references.
  TASK-89 is UI-additive only. Don't re-split.
- **Pins are plain table writes through RLS** (INSERT/DELETE self-only), no RPC.
  Why: no invariant beyond the policy itself; decision-1 reserves RPCs for business
  rules, and the only cross-user pin writes (move/remove_member) already live in
  SECURITY DEFINER RPCs.
- **TASK-93 seeding is transactional with signup** (failure blocks signup loudly).
  Why: a user without their personal project breaks the "My Work works immediately"
  promise (AC#1); a silent catch would hide it. `seed_project` is internal-only
  (REVOKE from anon/authenticated), called by trigger + create_project wrapper,
  because auth.uid() is not the new user inside handle_new_user.
- **Personal project = normal project, no flag column.** My Work accent keys off
  `iteration_length = 1`. Adding an `is_personal` flag was rejected as speculative.
- **TASK-98 baseline comes from `supabase db dump`, never a hand-squash.** Why:
  grants, triggers, and sequence defaults are exactly the things a manual squash
  loses (sharp-edges: missing GRANT silently 401s). TASK-93's trigger must land
  before the production reset so the owner's re-signup exercises it. Integration
  rows (git-webhook secret, Slack) die with the reset — re-setup is in the runbook.

**Owner decisions 2026-07-20 (all three former open questions closed — don't reopen):**
1. TASK-82: Kanban '+' = one on the unstarted-category column header.
2. TASK-89: NO global quick-add shortcut (doc-8 §10 decision now made); the My Work
   header '+' adds into the personal project.
3. TASK-89: Today/Assigned two-section layout confirmed; done stories drop out of
   Today immediately (owner rejected keep-until-midnight).

Related: [[doc8-locked-decisions]], [[review-sharp-edges]].
