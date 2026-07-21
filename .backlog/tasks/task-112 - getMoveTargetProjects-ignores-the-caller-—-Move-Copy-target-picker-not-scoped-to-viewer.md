---
id: TASK-112
title: >-
  getMoveTargetProjects ignores the caller — Move/Copy target picker not scoped
  to viewer
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 10:59'
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
- [ ] #1 getMoveTargetProjects filters project_members by the signed-in user's id (via supabase.auth.getUser()), not just role
- [ ] #2 A test proves a viewer-only member of Project B does not see Project B as a Move/Copy target
- [ ] #3 pnpm test + lint green
<!-- AC:END -->
