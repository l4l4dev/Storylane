---
id: doc-19
title: >-
  19 — Session handoff 2026-07-24 — Epic/Story unification chain (TASK-178/179
  done, resume at 180)
type: other
created_date: '2026-07-24 05:55'
updated_date: '2026-07-30 05:58'
---
# 19 — Session handoff 2026-07-24 — Epic/Story unification chain (TASK-178/179 done, resume at 180)

Design of record: **doc-18** (`backlog doc view doc-18 --plain`). This handoff is
about the *implementation* of that design.

## Current state

**On `main` (pushed):** the doc-18 design + full spec integration + the Backlog
tasks. Commits `dc3e987` (spec/doc-18/milestone/TASK-178..185) and `412b39c`
(completed-task archive).

**On branch `feat/epic-story-unification` (local only, NOT pushed):** the
implementation chain. Three commits on top of main:
- `34cf59a` — TASK-178 DB: migration `20260724043408_epic_story_unification_schema.sql`
  (stories gains `parent_id` / `is_container` / `epic_color` + off-board CHECK;
  drops `stories.epic_id` + the `epics` table) and
  `20260724051506_epic_story_unification_rpcs.sql` (re-anchor `update_story` +
  `create_story_tracker` off epic_id onto parent_id). Types regenerated.
- `a1e3dc2` — TASK-178 Web: removed every epics-table / epic_id reference across
  the app (board badge/filter, draft-card field + prop chain, story detail's
  epic field → parent_id preserved across autosave, /epics placeholder, epics
  CRUD UI deleted, all tests updated).
- `7766c34` — TASK-179 DB: `20260724054954_epic_story_unification_triggers.sql`
  (enforce_single_level_nesting + maintain_is_container/recompute_is_container)
  + `apps/web/lib/utils/nesting.integration.test.ts`.

**Verified:** all three migrations apply clean via `supabase db reset` + seed.
TASK-178 — `tsc` 0 errors, `eslint` clean, `pnpm test` 703 passed / 211
integration skipped. TASK-179 — the 5 nesting triggers pass live
(`SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/nesting.integration.test.ts`).

**Working tree:** clean on the branch except `apps/web/.claude/` (untracked local
config — NOT ours, never commit it).

## Branch strategy (important)

The whole 178→184 chain lives on `feat/epic-story-unification` and merges to main
as a unit when complete. Reason: TASK-178 drops the `epics` table, which leaves
`promote_story_to_epic` broken until TASK-181 removes it — so intermediate states
are only coherent on the branch, never on main. Do NOT merge the branch until the
chain is functional again (at least through 184) and reviewed.

## In progress / next work — resume at TASK-180

Read the current task first: `backlog task view TASK-180 --plain`. Chain order &
dependencies:

- **TASK-180** (next, @claude-opus-4-8) — roll-up + board/velocity/My Work
  integration. Add `is_container = false` to the zone predicate / board queries /
  velocity / auto-assign / My Work; implement the container roll-up (headline
  state + point sum from children) as a **`packages/core` pure function with
  golden fixtures** (Web/iOS parity — see doc-18 §5 for the exact rule, incl. the
  partial-completion branch). `set_story_state` also needs the `is_container`
  reject guard (doc-18 §4) — verify whether that belongs here or is already
  implied; the CHECK from TASK-178 already blocks the dangerous state.
- **TASK-181** (@claude-opus-4-8) — `split_story` RPC + drop
  `promote_story_to_epic` and all its UI/tests (story-peek-menu Promote item +
  PromoteToEpicDialog, `promoteStoryToEpic` action, promoted-epic-banner + board
  banner, activity.ts case, promote.integration.test, the grant-lockdown
  allowlist entry, the personal-project-seal-seams promote block). doc-18 §6-§7.
- **TASK-182** (@claude-opus-4-8) — rls-security-reviewer pass over ALL the
  chain's migrations (178-181). This is where the migrations get their required
  security review (deferred from the per-task flow on purpose).
- **TASK-183** (@claude-sonnet-5) — Split Studio screen `/stories/[id]/split`
  (doc-18 §7). Depends on 181 and 184.
- **TASK-184** (@claude-sonnet-5) — List 1-level accordion + `/epics` container
  list (replaces the placeholder) + story-detail Parent picker (with the
  containerize confirmation, doc-18 §9). Depends on 178/180.

## Deferred / open items

- **iOS**: TASK-178 AC#4 mentions "repository layers Web/iOS", but iOS was left
  untouched per the project's Web-first rule. Suggest moving the iOS clause to the
  iOS port track rather than blocking TASK-178. iOS `Story` model still has epic.
- **Chain finalization**: `/code-review` for the chain and formally marking
  TASK-178/179 Done are deferred until the chain is review-ready (TASK-182 covers
  the RLS side). TASK-178 and TASK-179 are currently left `In Progress`.
- **TASK-185** (separate, m-2): consolidate residual legacy task tracking into Backlog — not part of this
  chain, do later.

## Environment

- Local Supabase running (`supabase status`; DB at 127.0.0.1:54322). `supabase db
  reset` replays all migrations + seed.
- Regenerate DB types after a migration: `supabase gen types typescript --local >
  apps/web/lib/database.types.ts`.
- Run from `apps/web/`: `pnpm test` (unit, integration auto-skipped) + `pnpm run
  lint`. Integration tests need `SUPABASE_INTEGRATION=1` and the dev user
  (`dev@storylane.local`) — gated, skipped by default.
- Migrations require the db-migrate skill workflow; every new function manages its
  own EXECUTE grants (grant-lockdown backstop).
