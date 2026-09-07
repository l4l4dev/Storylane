---
id: TASK-251
title: 'Realtime: in-process event bus and SSE invalidation stream per project'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
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
