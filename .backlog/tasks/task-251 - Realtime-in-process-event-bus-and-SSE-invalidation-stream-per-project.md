---
id: TASK-251
title: 'Realtime: in-process event bus and SSE invalidation stream per project'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
updated_date: '2026-09-07 09:01'
labels: []
milestone: m-9
dependencies:
  - TASK-250
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: medium
type: feature
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc §6. After a service transaction commits, publish {type:'project.changed', projectId} on an in-process bus; GET /api/projects/:id/events streams SSE with a 15–30 s heartbeat to authorized members (project:read via withProject, then hold the connection); clients refetch on events. No payloads, no replay. Connection cleanup on abort.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SSE route is in ROUTE_ACTIONS and passes the matrix (non-member 404, anonymous 401)
- [ ] #2 A story mutation delivers one project.changed event to a connected subscriber of that project and none to another project's subscriber (test)
- [ ] #3 Heartbeat comment frames are sent and closed connections are removed from the bus (test)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/phase-1: 96e6278 + 3288776 (EventBus keyed by project id, withProjectChange publishing tx.projectId after commit on every mutation route, GET /api/projects/:id/events authorized before streaming with 20 s heartbeat, per-user cap 20 → 503 too_many_streams, lifecycle guards on aborted/closed/raw signal, timer cleanup; matrix streaming row). 434 tests. authz-reviewer: approve with fixes (all fixed). Phase 2: add withTwoProjectsChange when cross-project move lands.
<!-- SECTION:NOTES:END -->
