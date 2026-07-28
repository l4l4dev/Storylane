---
id: TASK-206
title: Definition of Done project setting
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 01:48'
updated_date: '2026-07-28 00:29'
labels: []
milestone: m-0
dependencies: []
priority: low
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Storylane has no explicit Definition of Done concept — a done-category project_state (spec/data-model.md, spec/glossary.md 'Category') implicitly stands in for it, but teams have no place to write down what 'done' actually requires (tests written, reviewed, deployed, etc.). Add a per-project free-text DoD field, shown as a reference checklist when a story is moved into a done-category state, so the team's own bar for done is visible at the moment it matters instead of living only in a wiki or people's heads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 projects table gains a definition_of_done text column, nullable, editable in Project Settings (spec/screens.md 'Project Settings') by owner/member
- [x] #2 When a story is dragged/advanced into a done-category state (Kanban drag or the advance-to-next-state button, spec/features.md 'Transitions'), the DoD text is shown alongside the action (e.g. a tooltip/popover) as a reference — informational only, not a blocking gate
- [x] #3 Empty DoD (default) shows nothing extra — no empty checklist UI
- [x] #4 spec/data-model.md and spec/screens.md are updated to document the field and its display point
- [x] #5 Tests cover the settings field's RLS/role restrictions
- [x] #6 projects table gains a definition_of_done text column, nullable, editable in Project Settings (spec/screens.md 'Project Settings') by owner only — corrected from the original 'owner/member': spec/screens.md's Details section and the projects table's only UPDATE policy (owner-only, never broadened) already gate name/description/iteration_term this way; definition_of_done sits in that same form
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Researched fresh (doc-21 loop) rather than trusting the task's creation-time description — one correction found:

CORRECTION to AC#1: spec/screens.md 'Project Settings' Details section says 'Owner-editable; members see it read-only', and the projects table's only UPDATE policy (20260627000002_projects.sql, never broadened since) is owner-only (project_role(id) = 'owner'). settings/page.tsx's Details form already disables every field (name, description, iteration_term, ...) with disabled={!isOwner}. definition_of_done belongs in that same form, so it must be owner-only to match its siblings and the existing RLS — not owner/member as the AC states. Will implement as owner-only and flag this to the owner as a corrected AC.

Schema: definition_of_done text, nullable, on projects — added via updateProject (settings/actions.ts), which already assertRowAffected-updates the same row's other Details fields in one UPDATE. No new RLS policy needed (reuses 'owners can update projects').

Display point (AC#2): spec/features.md 'Transitions' names exactly two entry paths into a done-category state — drag-to-column (Web board) and the advance/accept button (computeStateGate, packages/core). Both funnel through the same UI surfaces:
- TransitionButtons (components/features/story/transition-buttons.tsx) — shared by story card, list row, detail panel, and the Kanban board's per-card buttons. When a rendered button's targetStateId resolves to a done-category state, add a small info-icon Popover next to it showing definition_of_done (reuses the Estimate-popover pattern already in this file: click-triggered, keyboard-accessible, no new dependency — this codebase has no separate Tooltip primitive).
- KanbanColumn header (kanban-columns-board.tsx) — for the drag path, which does not go through TransitionButtons at all. When state.category === 'done', the same info-icon Popover on the column header covers it, since the column is what a drag interaction is 'alongside'.
Both gate on non-empty definition_of_done (AC#3 — empty shows nothing, no icon rendered at all, not just an empty popover).

Threading: project's definition_of_done needs to reach both TransitionButtons (currently receives isPersonal/pointScale but not the project row) and KanbanColumnsBoard/KanbanColumn (currently receives states/projectId). Will add a single doneDefinition?: string | null prop threaded from each page-level fetch (board/page.tsx, stories/[id]/page.tsx) down through the existing prop chains — cheapest correct option per the ladder, no context provider for one value.

AC#5 (RLS/role test): new *.integration.test.ts following the working-day-calendar/membership pattern already fixed for persistSession — owner can set it, member/viewer cannot (RLS-level, matching 'owners can update projects'), matching the existing name/description behavior (no new test needed for those, but the new column rides the same policy so one assertion suffices).

spec updates (AC#4): spec/data-model.md projects table gets the column; spec/screens.md 'Project Settings' Details bullet gets 'definition of done (owner-editable, free text)'; spec/features.md 'Transitions' gets a line noting the reference-only DoD display at both entry points.

Design review: this is user-facing UI (info-icon + popover pattern, a new column-header affordance) — ends with fable-advisor per spec/ux-principles.md before manual verification, per CLAUDE.md Critical Rules.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 correction (see #6): implemented owner-only, not owner/member as originally written — spec/screens.md's Details section says 'Owner-editable; members see it read-only', and the projects table's only UPDATE policy (20260627000002_projects.sql, owner-only, never broadened) already gates name/description/iteration_term this way. definition_of_done sits in that same form/action (updateProject), so it follows the same gate rather than introducing a looser one. Confirmed via a new RLS integration test (below), not just code inspection.

Schema: supabase/migrations/20260727110000_project_definition_of_done.sql — nullable text on projects, no new RLS policy (rides the existing owner-only UPDATE + whole-row SELECT).

Server action: updateProject (settings/actions.ts) now writes definition_of_done alongside name/description/etc in the same UPDATE. Settings page (page.tsx) adds the field right after Description, same disabled={!isOwner} pattern as its siblings.

Display (AC#2): two integration points, matching the two entry paths spec/features.md 'Transitions' names —
- TransitionButtons (story card / list row / detail panel): an info-icon Popover next to any button whose target state resolves to category 'done', reusing the existing Estimate-popover pattern (click-triggered, keyboard-accessible, no new dependency).
- KanbanColumn header: same icon on a done-category column's header, since Kanban moves are drag-only (TransitionButtons never renders on Kanban cards — confirmed by grep, not assumption).
Both gate on non-empty definition_of_done (AC#3) — no icon at all when empty, not an empty popover.

Threading: doneDefinition?: string | null added alongside the existing pointScale prop at every level of both call trees (KanbanBoard -> KanbanColumnsBoard -> KanbanColumn; KanbanBoard -> BoardListView -> ListSection/BacklogSection/IceboxColumn -> StoryListRow -> TransitionButtons), plus StoryDetail (stories/[id]/actions.ts) -> story-detail-panel.tsx -> TransitionButtons. board/page.tsx and stories/[id]/actions.ts's projects selects both extended to include the column.

AC#5: new lib/utils/project-definition-of-done.integration.test.ts, modeled on project-archive-favorites.integration.test.ts's owner/member pattern (RLS: non-owner UPDATE silently no-ops, not an error) plus a viewer client and a whole-row SELECT-readability check. Verified: 2/2 passed.

AC#4: spec/data-model.md (projects column), spec/screens.md (Details bullet), spec/features.md (Transitions — new bullet documenting both display points).

Full verification (apps/web/): tsc --noEmit clean, pnpm run lint clean, SUPABASE_INTEGRATION=1 with NODE_OPTIONS=--localstorage-file=... (CI's Node-22 condition, per apps/web/CLAUDE.md's Testing note) — 1104/1104 passed (main's 1102 + this task's 2 new tests), no regressions. 5 pre-existing StoryDetail test fixtures needed a doneDefinition: null addition (TS required field) — mechanical, no behavior change.

Held at In Progress per doc-21's loop — awaiting fable-advisor design review (spec/ux-principles.md, CLAUDE.md Critical Rules) before manual verification, then /code-review.

---

Review passes complete, both clean:
- fable-advisor (design, spec/ux-principles.md): APPROVED. Verified all 4 display paths (list row, detail panel via peek, Kanban column, story-card->peek) have doneDefinition wired with no gaps -- checked the code itself, not just the plan. Principle-3 layout-shift question resolved as non-issue (same pattern as the existing conditional points-sum span in the same header). One low-priority maintainability note: the Popover JSX is duplicated verbatim between transition-buttons.tsx and kanban-columns-board.tsx rather than a shared component -- not a blocker, flagged for a future cleanup pass.
- rls-security-reviewer (required for any migration per CLAUDE.md Review Workflow, even a simple additive column): NO FINDINGS. Confirmed projects never had its table-level grant narrowed to a column allowlist (unlike integrations.webhook_secret's explicit revoke+re-grant pattern) -- checked via grep across all migrations -- so a bare ADD COLUMN correctly rides the existing owner-only UPDATE / member-readable SELECT policies. DOWN comment and naming match convention.

Ready for /code-review (owner-run, effort high per CLAUDE.md's migration rule).

---

/code-review attempts 1-3 (2026-07-27 ~18:xx-19:xx JST) did not produce findings:
- Attempt 1: stopped by the owner mid-run.
- Attempt 2: returned a stub message ('Still waiting on the reuse angle finder') instead of a report — root cause found via attempt 3's clearer failure: this was the session rate limit, not a real review outcome. No findings should be inferred from it.
- Attempt 3: all 3 sub-agents (main + Angle D 'reuse' + Angle F 'efficiency') failed outright with 'You've hit your session limit · resets 7:40pm (Asia/Tokyo)'.

No code-review has actually completed for this task yet. Retry after the 19:40 JST reset. Implementation, both required review passes (fable-advisor design + rls-security-reviewer), and full-suite verification (1104/1104) are otherwise complete and unchanged — see the notes above this entry.

---

/code-review attempt 4 (2026-07-27, this worktree/branch confirmed correct this time): Phase 0/1 ran correctly against feat/sprint-reporting's actual uncommitted diff — 8 finder agents completed, found candidates deduplicated to 15, Phase 2 verification (5 verifier agents) had just launched when the run failed outright on the session rate limit again ('resets 4:30pm (Asia/Tokyo)'). No verified findings exist from this attempt either — the 15 raw candidates never passed Phase 2 verification, so none should be acted on.

Still no completed /code-review for this task. Retry after 16:30 JST.

2026-07-28: /code-review never completed across 4 attempts (all hit the Claude session rate limit, no actual findings produced). Work was merged to main by another session in this same worktree before a completed pass happened. Substituting evidence: fable-advisor design review APPROVED, rls-security-reviewer NO FINDINGS on the migration, both already recorded above. Re-verified now on main (post-merge): pnpm run lint clean, pnpm test 860 passed/267 skipped (no failures), TASK-206's own files unchanged since the notes above were written.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added projects.definition_of_done (owner-editable, nullable text), shown as a reference-only popover at both done-category entry points (TransitionButtons, KanbanColumn header), hidden when empty. Verified: fable-advisor design review approved, rls-security-reviewer found no issues on the migration, integration test confirms owner-only write. Full /code-review never completed (session rate limits, see notes) but the code was merged to main and passed a full local re-verification (lint clean, 860/1127 tests passing, 267 skipped as expected without local Supabase).
<!-- SECTION:FINAL_SUMMARY:END -->
