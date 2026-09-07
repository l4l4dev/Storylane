---
id: TASK-249
title: >-
  Projects and states: create project (creator = owner, seeded default states),
  list mine, settings, states CRUD with two-step reorder
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
updated_date: '2026-09-07 05:56'
labels: []
milestone: m-9
dependencies:
  - TASK-247
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - spec/permissions.md
priority: high
type: feature
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Services + routes for projects and project_states per spec/permissions.md (project:read/update/archive/delete, state:read/write/delete). POST /api/projects creates the project and its owner membership and seeds the default state template from spec/fixtures/state-templates.json (categories per spec/data-model.md). GET /api/projects lists the actor's projects (self rule). PATCH /api/projects/:id (owner) incl. archive/unarchive. States: create/update/rename/reorder/delete per matrix; category immutable (guard trigger from TASK-246); reorder via reorder(tx, …). Archived project → 409 on writes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every new route has a ROUTE_ACTIONS entry and passes the 5-actor matrix
- [ ] #2 Creating a project seeds states matching spec/fixtures/state-templates.json (golden test)
- [ ] #3 State reorder to a full reverse leaves positions 0..n-1 (test); category change attempt → 409/400 with the trigger message
- [ ] #4 Archived project rejects state writes with 409 project_archived and still serves reads
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/phase-1: ab02a0b + c9ce51f (services: createProject in one immediate tx with template seeding from spec/fixtures/state-templates.json, listProjects active→name→createdAt, updateProject with point-scale validation, setArchived, states create/update/reorder/delete with state_in_use / state_last_of_category / state_category_immutable; BootstrapScope branded), e73a558 + ef4b961 (routes for projects and states, manifest + fixtures, validation after authorization, HttpError from reorder, PATCH body validation, HTTP 409/404 tests). 340 tests. authz-reviewer on e73a558: approve with fixes (all fixed).
<!-- SECTION:NOTES:END -->
