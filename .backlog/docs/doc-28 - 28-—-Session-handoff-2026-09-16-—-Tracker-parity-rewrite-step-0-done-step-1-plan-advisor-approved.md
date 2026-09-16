---
id: doc-28
title: >-
  28 — Session handoff 2026-09-16 — Tracker-parity rewrite: step 0 done, step-1
  plan advisor-approved
type: guide
created_date: '2026-09-16 11:51'
updated_date: '2026-09-16 11:52'
---
# Session handoff 2026-09-16 — Tracker-parity rewrite

Owner decision 2026-09-16: Storylane becomes a **faithful copy of Pivotal Tracker**
(final 2024 form) — every panel, the workflow, the density and text sizes; only colours
may differ. Existing code may be discarded; the Docker-installable self-host form stays.
Design: `docs/design/2026-09-16-tracker-parity-rewrite-design.md` (owner-approved §1–2,
delegated §3–5; fable-advisor approve-with-corrections folded in).

Archive this doc as soon as the next session has consumed it (Doc Hygiene rule).

## State at handoff

Branch **`rewrite/tracker`** (off `rewrite/phase-1` = eea9178), 12 commits, all docs/scripts,
no product code changed yet. Working tree clean except `.claude/agent-memory/fable-advisor/*`
(advisor's own notes, leave them). Local tags `rewrite-phase-0` (3f5177c) and
`rewrite-phase-1` (eea9178) exist; **nothing is pushed**.

Done (step 0 of design §3.3, plus the step-1 plan):

- Reference corpus (git-ignored, `docs/reference/tracker/`): 195 help pages, 905 images,
  REST API v5 reference, and **the real application stylesheet**
  (`assets/assets.pivotaltracker.com/next/assets/next/<hash>-next.css`, 2025-03-03 and
  2024-10-09 captures, ~700 KB, CSS-Modules-hashed class names, Open Sans 300/400/600/700).
  Regenerate with `bun scripts/tracker-corpus/fetch.ts` (~10 min cold, idempotent);
  bundle CSS with `python3 scripts/tracker-corpus/extract-css.py docs/reference/tracker/assets`.
- Committed derived notes (`docs/reference/tracker-notes/`): `core-model.md` (779 lines,
  fields/rules from the API reference, §9 unknowns, §10 divergences), `project-view.md`
  (582 lines; screenshot measurements turned out ~13% small — the CSS table in §6 is
  authoritative), `css-tokens.md` (399 lines, selector-sourced values for every project-view
  element, palette, version note).
- Step-1 plan `docs/plans/2026-09-16-tracker-step-1-core-model.md` (5,355 lines, 22 tasks).
  Tasks 4 (permissions) and 5 (schema squashed to a fresh 0000) passed the `/advisor` gate
  with corrections, all applied (commit 8d5bf20). Tasks 11–16 and 21 carry interfaces +
  prose rather than full code — expand them at execution time.
- Superseded Backlog docs archived: doc-8/11/12/14/15/16/18/20/27.
- `.github/workflows/publish.yml` now publishes from `rewrite/tracker`.

## Owner actions needed (blocking or decisions)

1. **Push** `rewrite/tracker`, `rewrite/self-hosted`, `rewrite/phase-1` and the two tags
   (91 rewrite commits exist only on this machine).
2. **Backlog structure** (tasks are proposed, not created — approval needed, see below).
3. Confirm whether the Vercel deploy workflow on `main` is still live
   (`chore/gate-deploy-behind-release` exists); design §4 says no commits land on `main`
   until `rewrite/tracker` merges.
4. TASK-244 / TASK-254 (merge phase 0/1, tag v0.1.0): proposal is to fold both into one
   "Tracker first release" task so m-8/m-9 can close.

## Proposed Backlog changes (for approval)

Milestones: re-scope **m-10** → "Tracker parity 1: core model + project view (design steps
1–4)" and **m-11** → "Tracker parity 2: panels & periphery (steps 5–10)".

Tasks, in To Do order (ordinals 100, 200, …):

| Proposed task | Assignee | Milestone | Content |
|---|---|---|---|
| Step 1a — remove doc-8 domain, squash migrations, Tracker schema + permissions | `@claude-opus-5` | m-10 | plan Tasks 1–6 (Task 4/5 advisor-approved; authz-reviewer pass after Task 4) |
| Step 1b — story/label/epic/task/comment/blocker/review services + routes | `@claude-sonnet-5` (ordering Task 9 → opus) | m-10 | plan Tasks 7–16 |
| Step 1c — packages/core iterations/velocity/planning/search + derived API + spec rewrite | `@claude-opus-5` | m-10 | plan Tasks 17–22 (incl. ARCHITECTURE/CLAUDE/REVIEW updates, decision-3) |
| Step 2 — project view frame + Icebox/Backlog/Current/Done panels | `@claude-opus-5` | m-10 | note gate: project-view.md + css-tokens.md exist; spec/screens.md rewrite |
| Step 3 — expanded story | `@claude-sonnet-5` | m-10 | needs an `expanded-story.md` note first |
| Step 4 — manual planning, team strength, velocity override | `@claude-sonnet-5` | m-10 | |
| Owner: push branches/tags, Vercel decision, fold TASK-244/254 | `@l4l4dev` | m-10 | this section's items 1, 3, 4 |
| Steps 5–10 | later | m-11 | create when step 4 is done |

## Next session — first prompt

> `backlog doc view doc-28 --plain` を読んで。Tracker-parity rewrite の Step 1a を始める。
> `docs/plans/2026-09-16-tracker-step-1-core-model.md` の Task 1〜6 を
> superpowers:subagent-driven-development で実行。Task 4 の後に authz-reviewer、
> Task 5 の DDL は advisor 承認済み(commit 8d5bf20 の内容から変えない)。
> ブランチは rewrite/tracker、main には触らない。

Before starting: `git status` clean, on `rewrite/tracker`; `backlog task list --plain` to see
whether the owner has created the proposed tasks (if not, ask — never create them unasked).

## Observations for the next session

- Wayback's CDX index was flaky all day ("Temporarily Offline" HTML with HTTP 200); the
  fetcher detects and retries. Never print its raw response.
- `packages/core` tests run with vitest (`pnpm --filter @storylane/core test`), not `bun test`.
- `iteration_overrides` is keyed `(project_id, number)` — the one exception to the
  `(id, project_id)` invariant; no child FK may ever reference it (advisor condition).
- The advisor's corpus findings live in `.claude/agent-memory/fable-advisor/learnings-core-model-note-gaps.md`.
