---
id: TASK-8
title: 'Project archive, favorites, search and sort'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-07 14:25'
updated_date: '2026-07-10 23:20'
labels:
  - web
  - db
milestone: m-0
dependencies:
  - TASK-7
references:
  - spec/screens.md
  - spec/data-model.md
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Projects page management features per spec/screens.md 'Projects page' and spec/data-model.md: owner-only archive (projects.archived_at, hidden behind an Archived filter, read-only while archived), per-user favorites (project_members.is_favorite, pinned first), name search, and sort (last updated default / name / created).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration adds projects.archived_at and project_members.is_favorite; rls-security-reviewer has reviewed it
- [x] #2 Pin toggle on cards; favorited projects sort first on /dashboard and in the sidebar switcher
- [x] #3 Search box filters by name; sort select offers last updated / name / created
- [x] #4 Tests cover archive gating, favorite ordering, and search/sort
- [x] #5 Owner can archive/unarchive from the card overflow menu with confirmation; archived projects appear only under the Archived filter (read-only enforced at the Move/Copy RPCs and this UI's own gating only — no DB-level lock across every write-capable table; see spec/rls.md)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per docs/superpowers/plans/2026-07-10-project-archive-favorites-search-sort.md via subagent-driven-development on branch feat/project-archive-favorites-search-sort (6 tasks + review-gate task, all task-reviewer-approved; Task 1 assigned to @claude-opus-4-8 per the new Backlog model policy since it's new tables/RLS):
- Migration: projects.archived_at, project_members.is_favorite, toggle_project_favorite RPC (design reviewed 2026-07-10: NOT FOUND raise, NULL guard, search_path, self-only write). move_story_to_project/copy_story_to_project re-check neither project archived (closes TASK-14 AC#7/#9).
- ProjectCardMenu (archive/unarchive with confirmation, favorite star), ProjectGrid (search/sort/archived filter, client-side over the already-fetched list), sidebar switcher favorites-first + archived-excluded.
- rls-security-reviewer passed the migration (no blocking findings) but flagged that spec/rls.md and this task's own AC#2 overstated the shipped read-only scope (DB-wide lock across every write-capable table was never in scope - only Move/Copy RPCs + UI gating). Softened spec/rls.md and spec/screens.md wording to match, corrected AC#2's text, filed TASK-30 to track full DB-level enforcement as explicit follow-up.
- web-conventions-reviewer: one cosmetic ESLint warning (unused mock param), fixed.
- Manual browser verification found and fixed a real UI bug: ProjectCard's header (title+Archived badge+mode badge+star+menu) overflowed and clipped the star/menu controls for longer project names - fixed with title truncate + flex-wrap.
- Final whole-branch review: ready to merge with fixes, where the one fix was a verification step, not a code change - the migration's DB-level contract (toggle_project_favorite permission matrix, archived-source/target rejections) was only exercised by CI-skipped integration tests. Ran them locally against supabase start: 19/19 passed (project-archive-favorites.integration.test.ts + move-copy.integration.test.ts additions).
- Minor/cosmetic notes from final review, not fixed (left as-is, low impact): empty-filter-result message says 'search' even when only the Archived toggle filtered everything out; the current project, if archived, doesn't show as checked in the sidebar switcher's dropdown list (still directly navigable); toggleFavorite has no toast on failure (silent revert, matches its documented best-effort design).
- Full suite: 329 passed, 0 failed (44 skipped without SUPABASE_INTEGRATION=1). Manually verified end-to-end in-browser: search/sort/archived-filter, favorite star toggle + persistence, archive to hidden-by-default to reappears-under-filter to unarchive, confirmation dialog text both directions.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added project archive/unarchive (owner-only, confirmation dialog), per-user favorites (pin, sorts first on /dashboard and sidebar), name search, and sort (last updated/name/created) to /dashboard. Closed TASK-14's deferred Move/Copy archived-project check. Read-only enforcement is deliberately narrow (Move/Copy + display gating only, not a blanket DB lock) — spec wording corrected to match, TASK-30 filed for full enforcement as follow-up. rls-security-reviewer and web-conventions-reviewer both passed; final whole-branch review (opus) approved with the one integration-test-run gap closed (19/19 passed locally); full suite green; manually verified in-browser, including a real UI overflow bug found and fixed.
<!-- SECTION:FINAL_SUMMARY:END -->
