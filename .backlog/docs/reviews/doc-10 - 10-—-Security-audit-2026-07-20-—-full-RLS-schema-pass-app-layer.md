---
id: doc-10
title: 10 — Security audit 2026-07-20 — full RLS schema pass + app layer
type: other
created_date: '2026-07-20 04:09'
updated_date: '2026-07-22 09:04'
---
# Security audit 2026-07-20 (Fable pass, pre-TASK-98 squash)

Scope: full RLS schema audit (rls-security-reviewer agent, live introspection over a fresh db reset) + app-layer review by Fable (webhook, auth, service-role usage, server actions). Ran after TASK-85/86 merged, before the TASK-98 baseline squash.

## Findings and outcomes

- HIGH (fixed, 20260720000003 + commit 66ff8f2): update_story RPC still referenced columns dropped by the doc-8 redesign (custom_status_id, stories.state) — every story detail autosave failed at runtime since the 2026-07-19 deploy. Rewritten onto state_id; p_custom_status_id removed; EXECUTE locked down (revoke public/anon, grant authenticated). Root cause: the 20260719000008-12 reanchor series missed it, and no test called the real RPC. Prevention: new update-story.integration.test.ts calls the real function so a body that no longer compiles against the schema fails CI.
- HIGH (fixed earlier same day, d02f751): iterations one-shot metric forge — see TASK-86 notes.
- MEDIUM (accepted): spec/data-model.md + spec/rls.md describe story_pins as existing; it is spec-first documentation for TASK-88 (not yet implemented). No action beyond TASK-88.
- LOW (fixed, same migration): profiles INSERT policy now rejects is_agent=true (symmetry with the 20260719000001 UPDATE column grant).
- LOW (fixed, git-webhook): story numbers overflowing int4 are treated as no-match instead of causing a 500 retry loop.
- LOW (DEFERRED): promote_story_to_epic fetches the story by id before the role check, distinguishing not-found from not-authorized — an existence oracle for story UUIDs. Align its initial SELECT with move/copy's membership filter next time the function is touched.
- LOW (absorbed by TASK-98): pre-convention early migrations lack DOWN blocks.

## Verified clean

RLS enabled on all 17 tables; composite-FK cross-project blocking (state_id/iteration_id/epic_id/activity_logs); story_labels cross-project guard; system-written columns protected (stories.number, completed_at unconditional trigger, project_states.category, calendar-exception reparent, iterations metrics); all 27 SECURITY DEFINER functions re-validate membership; EXECUTE grants 1:1 with the allowlist test; finish_story_from_git + project_capacity service-role-only; shares_project_with scoping; realtime publication RLS-gated. App layer: webhook HMAC (constant-time, verify-before-parse, secret column hidden from authenticated), dev login triple-guarded, service-role key server-only (single documented consumer).

## Known accepted (do not re-file)

user_time_off date visibility trade-off; webhook 404/401 integration-existence probe (UUID-gated); webhook replay (idempotent RPC); DB any-to-any state transitions (doc-8).
