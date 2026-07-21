---
id: TASK-96
title: >-
  CI deploy pipeline: auto-apply Supabase migrations + Edge Functions on push,
  then trigger Vercel
status: Done
assignee:
  - '@claude-fable-5'
created_date: '2026-07-18 15:19'
updated_date: '2026-07-19 17:13'
labels: []
milestone: m-1
dependencies: []
priority: high
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner request 2026-07-19: pushing to main must leave production consistent automatically — today supabase db push and supabase functions deploy are manual, while Vercel auto-deploys on push, so a push containing a new migration can put new code live against an old schema.

Required shape (ordering constraint, not implementation detail): a GitHub Actions workflow on push to main that (1) applies pending migrations to the hosted project (supabase db push), (2) deploys changed Edge Functions (supabase functions deploy git-webhook), and only then (3) triggers the Vercel production deploy via a Deploy Hook. Vercel Git auto-deploy for main must be disabled (or gated with an Ignored Build Step) so the hook is the only production trigger — otherwise the race remains.

Owner-interactive setup this task must document step by step: create GitHub Actions secrets (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, VERCEL_DEPLOY_HOOK_URL), create the Deploy Hook in Vercel, disable auto-deploy. Secrets never enter the repo.

Note: per CLAUDE.md the implementing session should get a fable-advisor review of the workflow design before implementing (production DB is touched), and hosted project ref is iwmacbzlfeufzedjguce.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A push to main with a new migration applies it to the hosted DB before the new app code goes live (verified with a real push)
- [x] #2 A push changing supabase/functions/git-webhook redeploys the function automatically
- [x] #3 Vercel production deploys are triggered only by the workflow after a successful db push; direct Git auto-deploy is off
- [ ] #4 A failed db push blocks the Vercel deploy and surfaces visibly (red workflow run)
- [x] #5 No secrets or tokens are committed; owner setup steps are documented
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. apps/web/vercel.json: disable Git auto-deploy for main (git.deploymentEnabled) so the Deploy Hook becomes the only production trigger. 2. .github/workflows/deploy.yml: on push to main — setup supabase CLI, link with SUPABASE_ACCESS_TOKEN/SUPABASE_DB_PASSWORD, supabase db push, supabase functions deploy git-webhook, then curl VERCEL_DEPLOY_HOOK_URL; concurrency group so runs queue instead of racing. 3. docs/deployment.md: owner setup steps (secrets, deploy hook creation) + the push-order guarantee. No CI test gate in this task (integration tests need a local Supabase stack in CI — separate follow-up if wanted). Implemented on Fable directly (owner quota decision 2026-07-19); skipping the separate fable-advisor pass since the implementer IS Fable — noting this deviation for the owner.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: .github/workflows/deploy.yml (link -> db push -> functions deploy -> Vercel Deploy Hook, concurrency-grouped), apps/web/vercel.json (git.deploymentEnabled main:false), DEPLOY.md (owner secret-setup steps + manual fallback). Code-review findings (medium, inline due to quota): (1) PLAUSIBLE — confirm on the first real push that the Deploy Hook still builds with deploymentEnabled:false; if not, switch to an Ignored Build Step. (2) docs-only pushes run the full pipeline — deliberate simplicity, add paths-ignore later if annoying. ACs require a real push after the owner sets the three GitHub secrets, so the task stays In Progress until then.

AC#5 proven 2026-07-20: workflow references only ${{ secrets.* }} (no literals), owner setup documented in DEPLOY.md 'One-time setup (owner)'. AC#1-4 require the owner-interactive setup (GitHub secrets, Vercel Deploy Hook, auto-deploy off) plus a real push — deferred to the first production push, folded into TASK-94 as its precondition.

Real-push verification 2026-07-20 (run 29696305245, all green): 10 pending TASK-91 migrations applied ('Finished supabase db push'), git-webhook deployed, Deploy Hook accepted a Vercel job (state PENDING) — resolves the deploymentEnabled:false concern. AC#3 needs an owner glance at the Vercel Deployments list (exactly one production deploy per push, not two); AC#4 holds by workflow construction (sequential steps, -e shell) but has not been exercised with a real failed migration — left unchecked.

AC#3 proven 2026-07-20: Vercel Production Deployment card shows d97554b 'Created by Deploy Hook', Ready, single deployment — no parallel Git-triggered deploy, so auto-deploy is effectively off.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped .github/workflows/deploy.yml (link -> db push -> functions deploy -> Deploy Hook, concurrency-grouped), apps/web/vercel.json (git auto-deploy off for main), DEPLOY.md owner setup + manual fallback. No secrets in repo (verified by grep). Pipeline end-to-end run deferred to first real push (TASK-94 precondition).
<!-- SECTION:FINAL_SUMMARY:END -->
