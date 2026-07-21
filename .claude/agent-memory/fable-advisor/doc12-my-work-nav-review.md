---
name: doc12-my-work-nav-review
description: 2026-07-21 pre-implementation design review of doc-12 (My Work Todo/Doing/Today/Done rework + sidebar nav restructure) — verdicts and required fixes before task decomposition
metadata:
  type: project
---

Reviewed doc-12 before decomposition (owner-approved via brainstorming, but design
not yet pressure-tested). Verdicts: **Thread A (My Work sections) = 修正付き承認**,
**Thread B (sidebar nav) = 承認**.

Thread A required fixes (don't let implementation skip these):
- **Done section must render LAST, not first.** doc-12's "priority order" (Done >
  Today > Doing > Todo) is correct as a *classification* rule (first-match-wins, no
  story in two sections) but doc-12 conflates that with *visual stacking order*.
  `spec/ux-principles.md` principle 9: "Archived or done things group in their own
  clearly-labelled section below active ones — never interleaved or sorted first."
  Putting Done at the top is the literal anti-pattern the principle names. If the
  owner wants Done-first anyway (e.g. daily-completion satisfaction), that needs an
  explicit recorded divergence (ux-principles.md's own "may diverge, never by
  accident" rule) — not a silent default.
- **Rollover-for-all-projects question is already answered by existing code, not new
  judgment territory.** `apps/web/app/dashboard/page.tsx` already calls
  `rolloverIterationSafely` via `projectsNeedingRollover` across the user's FULL
  project list (not just personal ones) — same idempotent RPC, per-project advisory
  lock, cheap early-return before ever calling it. My Work reading current-iteration
  ids for ALL projects (for the new filter toggle) should reuse this exact shipped
  pattern (`lib/supabase/rollover.ts`), not re-derive a new answer. Not a new N+1 risk.
- **doc-12's claim "`completed_at` already... indexed for iterations history" is
  wrong** — grepped `supabase/migrations/*.sql` for `create index`: only
  `stories_project_id_idx` / `stories_iteration_id_idx` / `stories_epic_id_idx`
  exist; nothing indexes `completed_at` or `assignee_id`. Not blocking at current
  dogfooding scale (RLS already scopes the scan via project_id), but correct the
  doc's rationale and leave a ponytail-style deferred marker (add
  `stories (assignee_id, completed_at)` if the Done query is measurably slow) rather
  than asserting it's already covered.
- Precedence walkthrough (pinned + in_progress + iteration ending today) holds up:
  `project_states.category` is a 4-way enum (`unstarted/in_progress/done/rejected`,
  `spec/data-model.md` ~line 115) so rejected stories land in Todo, never Doing or
  Done — matches doc-12's own claim, no edge case found.
- Cross-thread gap: per-project row color has no defined relationship to the
  sidebar switcher or dashboard cards (grepped, no existing colorFor/hash utility
  anywhere in the web app to reuse) — decide explicitly whether it's My-Work-local
  or meant as a project-identity color reused elsewhere; doc-12 leaves this implicit.
- No iOS `/my-work` screen exists yet — decision-1's shared-golden-fixtures rule
  doesn't apply to the new 4-way split function yet; keep it web-only TS in
  `apps/web/lib/utils/my-work.ts` like today's 2-way version (YAGNI, don't
  preemptively move to packages/core).

Thread B: approve as designed. No orphaned test from removing TASK-104's My-Work
"New project" button — no `my-work/page.test.tsx` exists (Server Component,
untested directly), and `InlineCreatePanel`'s `defaultOpen`/`?new=1` mechanism is
reused by the new sidebar entry, not duplicated, so `inline-create-panel.test.tsx`
stays valid unchanged. Fixed-link-vs-dropdown asymmetry isn't a ux-principles.md
violation (no principle addresses nav-item symmetry) and is functionally justified
(My Work = one fixed destination; Projects = N-item switcher). Button size default
(h-8) vs sm (h-7) claim verified correct against `components/ui/button.tsx`.
Implementer must still update `app-sidebar.test.tsx` for the fixed link + removed
dropdown entry + resized trigger, and add the TASK-104 supersede comment via the
`backlog` CLI (doc-12 says to, don't skip).

Related: [[review-sharp-edges]], [[owner-review-preferences]],
[[remaining-chain-design-decisions]].
