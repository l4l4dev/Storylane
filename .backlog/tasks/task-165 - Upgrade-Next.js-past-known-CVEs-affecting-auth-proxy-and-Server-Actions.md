---
id: TASK-165
title: Upgrade Next.js past known CVEs affecting auth/proxy and Server Actions
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
updated_date: '2026-07-23 05:46'
labels: []
milestone: m-1
dependencies: []
priority: high
type: chore
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex security review (2026-07-23) flagged next 16.2.9 in apps/web/package.json:23 — pnpm audit --prod reports 8 High / 7 Moderate advisories, including an auth-bypass-adjacent issue touching apps/web/proxy.ts:5 and Server Actions DoS/SSRF classes. RLS still protects data access, but the route-level auth bypass itself is not mitigated. Fix is upgrading to Next.js >=16.2.11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/web/package.json's next dependency (and any lockstep-required peer deps) is bumped to >=16.2.11
- [x] #2 pnpm audit --prod from apps/web shows zero High/Critical advisories for next
- [x] #3 pnpm test, pnpm run lint, and a production build (pnpm run build) are green from apps/web after the bump
- [x] #4 The dev-login / OAuth callback flow gated by proxy.ts is manually smoke-tested in a browser post-bump and documented in the final summary
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
next 16.2.9 -> 16.2.11, eslint-config-next matched to 16.2.11 (lockstep pin).
pnpm audit --prod: zero advisories against the "next" package itself post-bump
(the earlier auth-bypass-adjacent / Server Actions DoS-SSRF class is gone).
6 unrelated transitive advisories remain (js-yaml, fast-uri, sharp, postcss,
@hono/node-server) via shadcn/@modelcontextprotocol/sdk and next's own
bundled sharp/postcss -- out of this task's scope (next package itself is
clean); flagged to the owner as a possible separate follow-up.
AC#4 (manual dev-login/OAuth callback smoke test) could not be run from this
session: the working tree's dev server on :3000 is owned by a concurrent
session and still serving the old 16.2.9 build (Next.js's own dev-lock
prevents a second instance in the same .next dir). Deferred to the owner
per the project's existing deferred-manual-verification precedent -- exact
steps left in the final summary / chat handoff.

AC#4 manually verified 2026-07-23: navigated to /auth/login, clicked 'Continue as dev user', reached /my-work signed in as dev_user with the board rendering (Todo/Today/Doing/Done). Confirmed under next@16.2.11 after fixing an unrelated macOS TCC (Full Disk Access) permission issue that had been blocking pnpm/node from starting a dev server in this environment.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bumped apps/web/package.json's next 16.2.9 -> 16.2.11 and eslint-config-next
to match (lockstep pin). pnpm install regenerated the lockfile onto
next@16.2.11. Verified: pnpm test (691 passed), pnpm run lint (clean),
pnpm run build (production Turbopack build succeeds, banner confirms
"Next.js 16.2.11"). pnpm audit --prod shows zero advisories against the
"next" package itself (the reported auth-bypass-adjacent / Server Actions
DoS-SSRF class is resolved); 6 remaining advisories are transitive and
unrelated (js-yaml/fast-uri via shadcn's CLI deps and mcp's SDK,
sharp/postcss bundled by next itself, @hono/node-server via the MCP SDK) --
noted as a possible separate follow-up, not created without approval.
AC#4 (manual browser smoke test of the dev-login/OAuth flow through
proxy.ts) is deferred: this session could not start its own dev server
because a concurrent session's dev server is already running on :3000 off
the old 16.2.9 build, and Next.js's dev lock blocks a second instance
against the same .next directory. Steps for the owner to verify are in the
chat handoff.
<!-- SECTION:FINAL_SUMMARY:END -->
