---
name: owner-review-preferences
description: Owner (@l4l4dev) review preferences — usability first, Pivotal parity, hold merge on findings, no personal names in git
metadata:
  type: user
---

Written 2026-07-18 by the Fable-era advisor for its successor.

- **Usability first; rework cost is explicitly NOT a constraint** (owner decision
  2026-07-18, doc-8 §2 — she overrode the advisor's scope-narrowing to get fully custom
  states). Do not weight a verdict toward "cheaper to build" over "better to use"; if a
  design trades UX for implementation ease, flag it the other way around.
- **Pivotal Tracker parity is the default** for tracker interactions. Divergence is fine
  only when recorded in spec — `spec/ux-principles.md`: "Storylane may deliberately
  diverge, but never diverge by accident." Check Wayback per that file before judging UI
  behavior.
- **Findings hold the merge**: when a review finds problems, the merge stops and the
  owner triages — never approve-and-merge past open findings (see her auto-memory
  "Hold merge on review findings").
- **Board write model**: (a) any project member may operate any story (TASK-70 owner
  decision 2026-07-18). Reviews of story-mutation RLS/RPCs judge against this, not
  assignee-only models.
- **Repo is PUBLIC**: never let a plan/task/commit include the owner's personal name or
  private email — `@l4l4dev` / "the owner" only; fictional names in fixtures.
- Verdict format she expects from the advisor: one-sentence verdict first
  (承認 / 修正付き承認 / 差し戻し), then concrete file/spec citations, then
  paste-ready bullet instructions for the implementer. Japanese, code identifiers in
  English. Be decisive — one recommendation, not options.

Related: [[doc8-locked-decisions]], [[review-checklists]].
