---
id: TASK-3
title: 'Task 11.5: Deploy + production webhook verification'
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 08:44'
updated_date: '2026-07-18 15:10'
labels: []
milestone: m-1
dependencies:
  - TASK-18
  - TASK-10
  - TASK-23
priority: high
ordinal: 1500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Supabase hosted migration push, Vercel deploy (root apps/web, Node 22, env vars incl. SUPABASE_SERVICE_ROLE_KEY), OAuth/site URL config, production smoke test, then real GitHub/Forgejo webhook verification for Task 12. Requires the owner's interactive auth (supabase login / vercel login) - prepare step-by-step instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Deploy infrastructure is complete and verified: Vercel production serves origin/main (36e4a44), all migrations applied to hosted DB, OAuth sign-in works in production, git-webhook Edge Function deployed and reachable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pre-deploy gate (owner, 2026-07-11): before executing this deploy task, the owner does a full manual UI review of the completed 2026-07-11 UX batch (TASK-32..46). Do not start deploy work until that review has happened and its findings are triaged.

Supabase free-tier inactivity notice received 2026-07-16: the hosted project (iwmacbzlfeufzedjguce) is scheduled for auto-pause due to no API activity (dev runs against local Supabase). Before starting this task, check the Supabase dashboard and unpause the project if it is paused (recoverable within 90 days of pausing; owner decided 2026-07-16 to leave it paused until deploy rather than keep-alive or upgrade).

2026-07-17 (from TASK-47/48/68 advisor verdict): after TASK-68 lifts the pnpm workspace root to the repo root, the Vercel project must set Root Directory = apps/web, rely on the repo-root pnpm-lock.yaml, keep 'Include source files outside of the Root Directory' enabled (so packages/core is bundled), and the build log should show pnpm 11 (packageManager moves to the root package.json).

2026-07-19 completion: owner confirmed Vercel production deployment is at 36e4a44 and disabled the email/password provider in hosted Auth. OAuth (GitHub+Google) sign-in verified working by the owner in production. git-webhook function verified reachable by unsigned probe (400 without project param; app-level 'No active github integration' JSON for an unknown project id, proving gateway passthrough and DB access). Original AC#1 (board smoke test) and AC#2 (merged-PR webhook verification) were descoped to TASK-94 by owner decision 2026-07-19 — the app is about to change (doc-8 chain), so end-to-end verification happens after those changes land.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @l4l4dev
created: 2026-07-09 05:06
---
Ordinal moved from 6000 to 17000 (2026-07-09, per the owner): confirmed no other To Do task lists TASK-3 as a dependency, so deploy-free work can proceed first. TASK-3 still depends on TASK-18/TASK-10/TASK-23 (all Done), so it stays ready whenever the owner wants to do the deploy.
---

created: 2026-07-09 05:10
---
Ordinal 17000 → 21000 (2026-07-09): 17000 collided with TASK-16.1 and sat before TASK-16.2–16.4, so it was not actually last. Now placed after all Web implementation tasks, matching the plan: finish all Web work → deploy → start iOS.
---

created: 2026-07-10 10:37
---
Code review 2026-07-10: add to the deploy checklist — the login page's 'Continue as dev user' button is hidden in production, but signInWithPassword with the fixed dev@storylane.local credentials is callable by anyone against the hosted Supabase URL + anon key. Ensure supabase/seed.sql is NEVER run against the hosted project (so the dev user doesn't exist there) and consider disabling the email/password provider in the hosted Supabase Auth settings.
---

author: @claude-fable-5
created: 2026-07-18 14:48
---
Status check 2026-07-18 (owner reported half-done deploy): CONFIRMED DONE — hosted Supabase project iwmacbzlfeufzedjguce is ACTIVE_HEALTHY (unpaused) and linked; ALL migrations pushed through 20260718000001 (free-mode removal included); a Vercel deployment exists (login page renders in production). NOT YET DONE — Supabase Auth URL Configuration: login code sends redirectTo=window.location.origin/auth/callback, but hosted Site URL / redirect allowlist almost certainly still default to localhost, so after OAuth the user is bounced back to localhost (matches the reported symptom). Remaining owner steps: (1) Supabase Dashboard > Authentication > URL Configuration: set Site URL to the production URL and add https://<prod-domain>/auth/callback to Redirect URLs; (2) verify GitHub/Google providers are configured with callback https://iwmacbzlfeufzedjguce.supabase.co/auth/v1/callback; (3) per comment #3: disable email/password provider on hosted and never run seed.sql there; (4) verify Vercel env vars (NEXT_PUBLIC_SUPABASE_URL=https://iwmacbzlfeufzedjguce.supabase.co, anon key, SUPABASE_SERVICE_ROLE_KEY) and build settings (Root Directory=apps/web, include files outside root, pnpm 11/Node 22). No local .vercel link and no vercel CLI installed — deploy was done via the web dashboard. Chrome extension was disconnected so dashboard settings could not be inspected directly this session.
---

author: @claude-fable-5
created: 2026-07-18 14:58
---
2026-07-18: Production OAuth sign-in confirmed working by the owner. Fix was: (1) new production GitHub OAuth App + Google redirect URI addition, both pointing at https://iwmacbzlfeufzedjguce.supabase.co/auth/v1/callback, credentials entered in hosted Auth providers; (2) Site URL / Redirect URLs configured. Remaining for this task: AC#1 production smoke test (board flow end to end), AC#2 real merged-PR webhook verification, plus security follow-ups from comment #3 (disable email/password provider on hosted, never run seed.sql there) and Vercel env/build settings verification.
---

author: @claude-fable-5
created: 2026-07-18 15:03
---
2026-07-19: git-webhook Edge Function deployed to hosted project by the owner (supabase functions deploy git-webhook, verify_jwt=false from config.toml). Verified reachable in production: unsigned POST without project param returns 400; POST with unknown project id returns the app-level 'No active github integration' error, proving gateway passthrough and DB access both work. origin/main = 36e4a44 matches the pushed migrations. Remaining: owner confirms Vercel production deployment is at 36e4a44, runs the board smoke test (AC#1), configures a real project integration + GitHub repo webhook and merges a [SL-n] PR (AC#2), and disables the email/password provider in hosted Auth.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Production deploy completed: hosted Supabase unpaused with all migrations applied, Vercel serving main (36e4a44), Auth URL config + production GitHub/Google OAuth apps set up (sign-in verified by owner), email/password provider disabled, git-webhook Edge Function deployed and probe-verified. End-to-end smoke test and real-PR webhook verification moved to TASK-94 (owner, after doc-8 changes).
<!-- SECTION:FINAL_SUMMARY:END -->
