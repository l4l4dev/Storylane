# Storylane — Architecture Relations

A short map of how things connect across the three layers (Web / iOS / Supabase), so relations don't have to be re-derived from scratch each session. Update this file when a new cross-cutting relation is introduced — keep it short, this is not a copy of SPEC.md.

## Entity relations (see spec/data-model.md for full column definitions)

```
profiles ──< project_members >── projects ──< integrations
                                     │
                    ┌────────────────┼────────────────┐
                  epics           iterations         labels
                    │                 │                 │
                    └──────< stories >┘──< story_labels >┘
                                │
                      ┌─────────┼─────────┐
                    tasks    comments  activity_logs
```

- `stories.iteration_id` / `stories.epic_id` are nullable (ON DELETE SET NULL) — a story can exist in the backlog with no iteration/epic.
- `iterations.velocity` is derived (see spec/velocity.md), not independently editable once `state = 'done'`.
- `activity_logs` fans out from `stories` but also references `project_id` directly — it survives story deletion.

## Cross-layer coupling

| Relation | Where it lives | Why it matters |
|---|---|---|
| Web ⇄ Supabase | `apps/web/lib/supabase/` | All web data access goes through here — never construct a Supabase client elsewhere in `apps/web`. |
| iOS ⇄ Supabase | `apps/ios/Storylane/Repositories/` + `Core/SupabaseClient.swift` | Same rule on iOS — Views/ViewModels never call Supabase directly. |
| Web ⇄ iOS | **No direct relation.** They never call each other. The only shared contract is the Supabase schema + RLS policies in `supabase/migrations/`. | A schema or RLS change must be validated against both repository layers, not just one. |
| RLS ⇄ role | `spec/rls.md` — `owner` / `member` / `viewer` via `project_members.role` | Every table with a `project_id` column is gated by this; a new table needs its own policy set, not an inherited one. |
| Velocity ⇄ story state | `spec/velocity.md` — only `accepted` stories count, `chore`/`release` types excluded | Auto-assignment logic (Task 6) and velocity finalization (Task 8) both depend on this rule; keep Web/iOS implementations in sync. |
| activity_logs ⇄ DB triggers | Postgres triggers in `supabase/migrations/` (added in Task 9) on `stories`/`comments` writes | Clients (Web/iOS/Edge Functions) never insert `activity_logs` directly — the trigger is the single recording path, so every write route is covered without duplicating logic per client. |
| Iteration rollover ⇄ lazy finalization | `spec/velocity.md` (Task 12.5) — iterations past `end_date` are finalized on first access; no cron in Phase 1 | Web and iOS must apply the identical rollover rule from one shared place per client (or it moves server-side to an Edge Function) — never implement it in only one client or duplicate it per view. Manual "Finish iteration" (2026-07-07) reuses the same finalization path, never a second one. |
| iteration_goals ⇄ rollover | `spec/data-model.md` + `spec/velocity.md` (2026-07-07) — future-iteration goals keyed by number, adopted into the real `iterations` row on rollover/manual finish | Goal adoption lives inside the shared finalization path; anything creating an iteration row must consult `iteration_goals`. |
| stories.completed_at ⇄ both modes | `spec/data-model.md` (2026-07-07) — set on `accepted` (tracker) or entering an `is_done` column (free), cleared on leaving | Two write paths (state transition, free-mode column move) must both maintain it; Focus view and free-mode done grouping read it. |
| Story Move/Copy ⇄ cross-project RPC | `spec/features.md` "Move / Copy" (2026-07-07) — SECURITY DEFINER RPC, membership checked for both projects | The only sanctioned cross-project write path; clients never move stories across projects with plain table writes. |

## Current phase

Web-first: Tasks 6–13 are implemented on Web, then ported to iOS (see `TASK.md`). Don't start an iOS task before its Web counterpart is done — the Web implementation is where spec ambiguities get resolved first.
