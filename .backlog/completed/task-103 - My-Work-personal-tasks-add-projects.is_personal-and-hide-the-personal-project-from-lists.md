---
id: TASK-103
title: >-
  My Work personal tasks: add projects.is_personal and hide the personal project
  from lists
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 05:59'
updated_date: '2026-07-21 10:07'
labels:
  - web
  - db
dependencies: []
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D1 (+ advisor corrections). Make My Work a personal-todo + cross-project dashboard by identifying the auto-created 'My Tasks' project with a real flag and hiding it (for its owner) from the projects list + sidebar switcher, so personal tasks and team projects stop mixing. Reverses doc-8's deliberate 'no is_personal flag' decision — justified because iteration_length===1 can't distinguish a legit 1-day TEAM project. See .backlog/docs/doc-11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New migration adds projects.is_personal boolean NOT NULL DEFAULT false + a partial unique index on (created_by) WHERE is_personal (one personal project per user, DB-enforced); handle_new_user is create-or-replace'd to set is_personal=true (the existing 20260721000001 migration is NOT edited)
- [x] #2 The /dashboard project query and the sidebar switcher exclude the VIEWER'S OWN personal project via (is_personal AND created_by = auth.uid()) — not a bare is_personal filter (an invited member of a personal project must still see it)
- [x] #3 My Work's isPersonal / solo-personal-project detection reads the is_personal flag, not iteration_length===1; empty My Work shows copy that frames the quick-add as adding a personal task
- [x] #4 Move/Copy target picker (getMoveTargetProjects) still lists the personal project — intentional, left unchanged
- [x] #5 The 'no flag' wording in spec/data-model.md, spec/features.md, spec/screens.md is updated with the reversal rationale; TASK-93 gets a comment noting doc-11 reversed it
- [x] #6 Migration passes rls-security-reviewer; UI passes fable-advisor design review; pnpm test + lint green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added projects.is_personal (+ partial unique index one-per-owner + BEFORE UPDATE pin trigger so it's settable only at signup INSERT); handle_new_user amended (new migration, 20260721000001 untouched). Dashboard + sidebar hide the viewer's own personal project via viewer-scoped filter (is_personal AND created_by=me); invited members still see it. My Work personal detection = is_personal AND created_by=viewer; empty-state + quick-add copy reframed as personal tasks. spec (data-model/features/screens) + TASK-93 updated. Verified: fable-advisor design review approved; rls-security-reviewer flagged the missing write-lock (co-owner cross-user rollover risk) -> fixed with the recommended pin trigger; 4 integration tests (flag/unique-index/viewer-scoped-hide/pin) + full web suite (523) + tsc + lint green.
<!-- SECTION:FINAL_SUMMARY:END -->
