---
id: TASK-144
title: >-
  TASK-139 follow-up: rls-security-reviewer pass missing on set_story_state
  personal exemptions migration
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 11:14'
labels: []
dependencies:
  - TASK-139
priority: high
type: bug
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-verification of TASK-139 (2026-07-22) found its AC #5 ('rls-security-reviewer pass on the migration') was checked off Done without ever running. supabase/migrations/20260722000008_set_story_state_personal_exemptions.sql (the is_personal estimation-gate/iteration-auto-assign exemption in set_story_state) has no recorded review — the review documented in TASK-138's comment #2 covers a different migration (my_work_columns), not this one. Per CLAUDE.md, every migration requires this review before it can be considered done, and this one touches a SECURITY INVOKER RPC's gating logic. Another session is currently doing test-related work in this area — do not start until that lands, then first check whether it already produced/covers this review before doing new work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 rls-security-reviewer has been run against 20260722000008_set_story_state_personal_exemptions.sql specifically, with findings recorded (task comment or note)
- [ ] #2 Any findings from that review are resolved or explicitly accepted with rationale
- [ ] #3 TASK-139's AC #5 reflects the real state (checked once the review is genuinely done)
<!-- AC:END -->
