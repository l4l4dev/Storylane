# Storylane Constitution

This constitution is deliberately a **pointer document, not a summary**. Storylane's
rules already live in canonical files that evolve with the project; restating them
here would only let the two copies drift apart. Each principle below states where
the authority lives and what a Spec Kit workflow must do with it.

## Core Principles

### I. The Product Spec Is `spec/`, Not `specs/`
`SPEC.md` (index) and the `spec/` directory are the canonical product
specification. Anything Spec Kit generates under `specs/<NNN-name>/` is a
per-feature working draft: useful during design, never authoritative. When a
feature ships, durable content is folded into `spec/`; the `specs/` folder
remains as history. A `/speckit-plan` or `/speckit-specify` run MUST read the
relevant `spec/` sections (via the SPEC.md index) before writing anything, and
MUST NOT contradict them silently — a deliberate spec change happens in `spec/`
with the owner's approval, not in a draft.

### II. Business Rules Live in the Database
Per `decision-1` (Backlog decision log): business-rule mutations live in
Postgres RPCs and invariants in the DB — server actions do not cover iOS, and
every table carries its own RLS policy set. Plans that add tables, RLS, or
concurrency-sensitive paths MUST route through the pre-implementation reviews
listed in `CLAUDE.md` (fable-advisor design review, `rls-security-reviewer`
for migrations). Spec Kit does not replace those gates.

### III. Backlog.md Is the Only Execution Tracker
Committed work is tracked as Backlog.md tasks (with assignee and milestone,
created only with the owner's approval) — see `CLAUDE.md` "Backlog.md
Workflow". Spec Kit's `tasks.md` is a decomposition draft: it may seed Backlog
tasks, but checkbox state in `tasks.md` is never the record of what was done.

### IV. Agent Workflow Rules Are in `CLAUDE.md`
Review workflow (`/code-review` before every commit proposal), git conventions
(no `git add -A`, PR vs direct-push policy, Conventional Commits), token
economy, and the model-assignment policy all live in `CLAUDE.md` and apply
unchanged inside every Spec Kit phase, including `/speckit-implement`.

### V. This Repository Is Public
Never write the owner's personal name or private email into anything
git-tracked — including every artifact generated under `specs/`. Refer to the
owner as `@l4l4dev` or "the owner"; use fictional data in examples and
fixtures. Secrets go in `.env`-family files only.

## Precedence

When documents conflict, the order of authority is:

1. `CLAUDE.md` (and `apps/*/CLAUDE.md` for their subtrees)
2. `spec/` + `SPEC.md` (product behavior)
3. Backlog tasks/docs/decisions (work of record, design history)
4. This constitution
5. Anything under `specs/` (drafts)

A conflict discovered mid-workflow is surfaced to the owner, not resolved by
editing the higher-authority document as a side effect.

## Governance

This constitution changes only with the owner's explicit approval, in its own
commit. Amendments update the version line below. The Spec Kit trial itself is
governed by the "Spec Kit (experimental)" section of `CLAUDE.md`; if that
section and this file disagree, `CLAUDE.md` wins (see Precedence).

**Version**: 1.0.0 | **Ratified**: 2026-08-13 | **Last Amended**: 2026-08-13
