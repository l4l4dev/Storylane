---
id: TASK-248
title: >-
  First-run setup: one-time setup token, 409 setup_required gate, admin
  creation, /setup page
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
updated_date: '2026-09-07 05:15'
labels: []
milestone: m-9
dependencies:
  - TASK-247
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: high
type: feature
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc §7 steps 1–4. On boot with zero users: generate a setup token, log it once to stdout, store its hash + expiry (30 min; regenerated on restart while no admin exists) in instance_meta. While zero users exist every /api/** route (except /healthz and /api/setup) answers 409 setup_required; the SPA routes to /setup. POST /api/setup takes token + email + password + display name, constant-time compare, rate limited, creates the admin inside BEGIN IMMEDIATE guarded by WHERE NOT EXISTS (SELECT 1 FROM users), then logs in. /setup is closed afterwards (404). Web: /setup page with the form and clear errors.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two concurrent setup submissions create exactly one admin (test)
- [ ] #2 Expired or wrong token → 403 with uniform message; after setup, /api/setup → 404 (tests)
- [ ] #3 While no user exists, GET /api/projects/:id → 409 setup_required (test) and the SPA shows /setup
- [ ] #4 Boot log contains exactly one setup-token line when no admin exists and none afterwards (test on the logger output)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/phase-1: 07ff3bc + 4f0ede4 (setup token minted per boot and logged once while no user exists, hash-only storage, 409 setup_required gate mounted csrf→gate→failClosed with exact /api/setup exemption, single-admin creation in one immediate transaction, pre-KDF read-only token check, per-IP limiter, input hygiene). 242 tests. authz-reviewer: approve with fixes (all fixed). Web /setup page is TASK-253. Deferred: INSTALL note that the token expires in 30 minutes and a restart reissues it (TASK-254); login route email trim symmetry.
<!-- SECTION:NOTES:END -->
