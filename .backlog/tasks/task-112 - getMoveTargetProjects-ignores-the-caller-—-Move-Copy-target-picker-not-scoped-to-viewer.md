---
id: TASK-112
title: >-
  getMoveTargetProjects ignores the caller — Move/Copy target picker not scoped
  to viewer
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 10:59'
updated_date: '2026-07-21 13:11'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 10900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #3. apps/web/app/stories/[id]/actions.ts:303 (getMoveTargetProjects) never filters by the signed-in user's id, so it returns projects where ANY member holds owner/member role, not projects the caller themself has that role in. A viewer-only member of another project can see it offered as a Move/Copy target, contradicting the documented owner/member-only rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 getMoveTargetProjects filters project_members by the signed-in user's id (via supabase.auth.getUser()), not just role
- [x] #2 A test proves a viewer-only member of Project B does not see Project B as a Move/Copy target
- [x] #3 pnpm test + lint green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add supabase.auth.getUser() to getMoveTargetProjects and filter project_members by .eq('user_id', user.id) — RLS on project_members scopes to any member of a project the caller belongs to, not just the caller's own row, so the missing filter let another member's owner/member role leak the project in as a target.
2. Extend apps/web/app/stories/[id]/actions.test.ts's supabase mock with a generic filtering select chain (eq/in/neq) and auth.getUser, add a regression test proving a viewer-only row is excluded even when another member owns the same project.
3. Run pnpm test + pnpm run lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix: apps/web/app/stories/[id]/actions.ts getMoveTargetProjects now resolves the caller via supabase.auth.getUser() and adds .eq('user_id', user.id) to the project_members query. Test: apps/web/app/stories/[id]/actions.test.ts — new mock select chain (eq/in/neq apply as real filters over fixture rows) + regression test with a project where the caller is viewer-only but another member is owner, proving it's excluded. Verified: pnpm exec vitest run on the file (5/5 pass), pnpm run lint clean, full pnpm test (559 passed, 186 pre-existing skips, 0 failed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
getMoveTargetProjects now filters project_members by the signed-in caller's user id, not just role, closing the leak where a viewer-only member saw a project offered as a Move/Copy target because another member held owner/member there. Verified via new regression test (apps/web/app/stories/[id]/actions.test.ts) plus full pnpm test (559 passed) and pnpm run lint (clean).
<!-- SECTION:FINAL_SUMMARY:END -->
