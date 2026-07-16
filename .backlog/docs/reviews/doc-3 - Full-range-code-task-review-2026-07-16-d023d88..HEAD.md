---
id: doc-3
title: Full-range code & task review 2026-07-16 (d023d88..HEAD)
type: other
created_date: '2026-07-15 23:56'
updated_date: '2026-07-15 23:56'
---
# Full-range code & task review — 2026-07-16

Scope: commits `d023d88..HEAD` (everything since the Codex full-codebase review, doc-1): TASK-32/33/35/38/39/41/42/44/45 UI batch, TASK-53/54/55/63 security hardening, TASK-56 slice 1 (move_story_board RPC). Method: 8 finder angles (line-by-line, removed-behavior, cross-file tracer, reuse, simplification, efficiency, altitude, conventions) + verification pass. 10 findings survived; call-site tracing found NO broken caller (grant lockdown, webhook_secret redaction, membership RPC migration all consistent).

## Findings (ranked)

1. **[CONFIRMED bug] move_story_board NULL-unsafe zone predicate** — `supabase/migrations/20260715000008_move_story_board.sql:195`. `not (v_current_id is not null and v_new_iteration = v_current_id)` evaluates NULL for a backlog story when an active iteration exists → zone misclassified 'single' → the list else-branch densely renumbers the CURRENT iteration's stories and skips the two-table backlog splice. Masked by the integration test deleting all iterations first. → Fix scheduled into TASK-56 slice 2 (notes updated).
2. **[CONFIRMED] Backlog-zone rule triple-defined** — same predicate independently in move_story_board.sql, board/actions.ts fetchBacklogOrder, lib/utils/kanban.ts zoneForStory. Drift = silent mis-resequencing. → TASK-58 note (document canonical source in spec/data-model.md).
3. **[CONFIRMED] activity_logs FKs unindexed on referencing side** — 20260715000006 composite FK + older SET NULL FK; only project_id is indexed. Story DELETE / promote_story_to_epic scans activity_logs. → TASK-58: add index on activity_logs(story_id).
4. **[PLAUSIBLE] git-webhook per-number RPC loop drops per-delivery atomicity** — supabase/functions/git-webhook/index.ts:177. Multi-number PR + permanent error on a later number leaves earlier stories finished while the delivery stays red. Transient errors recover via retry + idempotency (by design); only permanent-error case is observable. Accepted for now; revisit if multi-story PRs become common.
5. **[CONFIRMED] Slack notifies 'done, 0 pts' for skipped iterations** — board/actions.ts notifyFinalizeEvents ignores the skipped flag. Already tracked: TASK-62 (this review independently re-derived it).
6. **[CONFIRMED] O(n²) backlog render** — board-list-view.tsx:865 area; nextRealRowId O(n) scan repeated per row. → TASK-64.
7. **[CONFIRMED] FreeBoardPage duplicate auth.getUser(), serialized before Promise.all** — board/page.tsx:320. → TASK-64.
8. **[CONFIRMED] Security-critical SQL boilerplate duplicated across new RPCs** — two fail-closed guard dialects (coalesce vs 'is null or'), last-owner check duplicated in membership_admin_rpcs, current-iteration lookup copy-pasted in 3–4 RPCs. One missed coalesce in a future RPC = privilege hole. → TASK-58: extract require_project_role / current_iteration / _assert_not_last_owner when the RPC family is next touched (TASK-51/57).
9. **[CONFIRMED] Click-to-edit trio drift** — savingRef guard only in IterationGoalBar (kanban-board.tsx); free-board's AddColumnButton/ColumnNameEditor lack it; ColumnNameEditor vs ColumnMenu full-row clobber-avoidance dance. → TASK-61 note (shared InlineEdit) + TASK-64 (patch-style updateCustomStatus, optional).
10. **[CONFIRMED] History-narration comments ×6** (Code Comment Policy) — story-peek-menu.tsx:122, settings/actions.ts:99, four test files. → TASK-65.

Rejected candidates (with reasons): unwired move_story_board RPC (deliberate slice split, TASK-56 slice 2 pending); sequential webhook loop as pure perf issue (advisory lock serializes server-side anyway); composite UNIQUE(id, project_id) write amplification (advisor-approved trade-off for the composite FK); dual insert affordances RowInsertMenu/InsertBetweenRows (deliberate TASK-42 UX decision; failure-path half is TASK-60); grant-lockdown event-trigger hardening (documented limitation, checklist + integration test backstop; optional future hardening).

## Task review outcomes (applied 2026-07-16)

- TASK-56: NULL-bug fix + regression test appended to slice 2 scope.
- TASK-58: item 5 (webhook client typing) struck — done by TASK-53 (WebhookClient); added index/guard-helper/zone-doc items.
- TASK-50: note added — move-path transitions must share transition_story's DB-side guard when TASK-48 lands.
- TASK-51: priority raised to High (must precede TASK-57 per the advisor rollout order 56→51→57→58).
- TASK-59/60/61/62: milestone m-0 assigned (were missing).
- TASK-61: note added — extraction should also cover free-board's two editors.
- Created TASK-64 (board render efficiency, Sonnet, m-0 Low) and TASK-65 (history-comment sweep, Haiku, m-0 Low).

## Open owner decisions

1. TASK-3 deploy gate says 'after manual UI review of the completed TASK-32..46 batch', but TASK-34/40 (m-0) are still To Do — decide: finish 34/40 first, or narrow the gate to the tasks actually done.
2. Finding 4 (webhook per-delivery atomicity): accept as-is or fold a set-based variant into TASK-58.
3. Optional: event-trigger enforcement for the function-grant lockdown class (new function shipped without its revoke line is only caught by the integration test today).
