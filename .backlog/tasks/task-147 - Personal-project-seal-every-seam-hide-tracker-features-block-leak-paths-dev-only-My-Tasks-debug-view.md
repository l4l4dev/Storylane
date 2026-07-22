---
id: TASK-147
title: >-
  Personal project: seal every seam (hide tracker features, block leak paths) +
  dev-only My Tasks debug view
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 11:22'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner decision 2026-07-22 (follow-up to doc-15): keep the hidden is_personal project as the storage model and invest in making it FULLY invisible instead. Trigger: 'Promote to Epic' on a personal task converts the story into an epics row in the hidden 'My Tasks' project (promote_story_to_epic DELETES the story - the task vanishes from My Work, my_work_story_state cascades away, and story_completions rows cascade too = permanent Done-log data loss), then navigation lands on the hidden project's iteration board. Audit and close ALL such seams; also add a dev-only debug window into the hidden project so the owner can inspect the real data. Not in scope: grouping features for personal tasks (if wanted later, that is a My Work concept, not epics).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Promote to Epic is hidden for personal-project stories in every surface that offers it, AND promote_story_to_epic itself rejects is_personal projects (new migration, full-function replacement; comment must name the story_completions cascade data-loss as the reason the guard is server-side)
- [ ] #2 Personal story detail hides tracker-only affordances: estimate/points, iteration display, epic selector. Checklist, comments, description, labels, and Move to project (team promotion) stay
- [ ] #3 Direct URL access to the personal project's pages (board/epics/iterations/activity/settings) redirects to /my-work - except via the debug entry below in development
- [ ] #4 Membership: verify the personal project cannot gain members (invite path); if any RPC-level path is open, close it with an is_personal guard
- [ ] #5 MCP: verify the personal project is not addressable via MCP tools and record the result in the task (doc-15 declared it out of scope - confirm reality matches)
- [ ] #6 Dev-only debug access: available ONLY in development builds, visually labeled as debug (e.g. a 'Debug: My Tasks' entry on My Work), giving the owner a way to inspect the hidden project's underlying data (stories + state, my_work_story_state, story_completions). No trace of it in production
- [ ] #7 fable-advisor design review against spec/ux-principles.md passes
- [ ] #8 rls-security-reviewer pass on the migration; pnpm test + lint green (from apps/web/)
<!-- AC:END -->
