---
id: TASK-163
title: >-
  My Work: Today card briefly flashes into Todo on reload (UTC vs local date
  hydration)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 22:24'
updated_date: '2026-07-23 00:55'
labels:
  - bug
  - my-work
milestone: m-5
dependencies: []
priority: medium
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/web/app/my-work/page.tsx:246 passes serverTodayKey={utcTodayKey()} (UTC date) for the server-rendered/hydration-stable first paint. my-work-sections.tsx reads it via useSyncExternalStore(NOOP_SUBSCRIBE, localTodayKey, () => serverTodayKey) — client snapshot is the browser's local date, server/hydration snapshot is UTC, by design (format.ts's own comment: 'a server render has no viewer timezone, so callers seed with utcTodayKey and correct to this on mount'). classifyMyWork buckets a story into Today only when story.todayDate === todayKey. For a JST viewer (UTC+9), local date is ahead of UTC date every day from 00:00-09:00 JST. Any reload in that window renders Today's cards using the stale UTC date first (todayDate !== todayKey yet -> falls into Todo), then jumps to Today the instant the client snapshot corrects post-hydration -- a visible misplace-then-correct flash, daily, for 9 hours, for any JST (or similarly UTC-ahead) viewer with anything in Today. Owner-reported.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reloading /my-work during the UTC/local-date mismatch window no longer shows a Today card in Todo, even briefly
- [x] #2 No regression to the existing UTC-seed/local-correct pattern for viewers where server and local date already agree
- [x] #3 Approach verified against this Vercel deployment before relying on it (see notes) -- if the assumption doesn't hold, propose a fallback before implementing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposed fix approach (not yet implemented, pending owner go-ahead, needs verification first): Vercel forwards a request geolocation header (x-vercel-ip-timezone, an IANA timezone string) to serverless/edge functions when available. If page.tsx can read it (via next/headers) and compute the viewer's local date server-side, the first paint could already use the correct local date -- no flash, no new dependency (native platform feature already in use per CLAUDE.md's Vercel hosting), graceful fallback to the current utcTodayKey() behavior when the header is absent. UNVERIFIED: whether this header is actually populated on this project's Vercel plan/deploy config -- must confirm empirically (e.g. log headers() in a route handler on the deployed app) before committing to this approach; if unavailable, need a different plan (e.g. a client-set cookie of the last-known local date, read on the next SSR pass) -- more moving parts, second choice.

Pivoted away from the Vercel x-vercel-ip-timezone header idea (would have needed empirical verification on the actual deployment, and ties the fix to a hosting-specific, unguaranteed header) to the cookie fallback flagged as the second choice: a plain 'local_date' cookie, portable across any host.

Implemented: my-work-sections.tsx writes document.cookie 'local_date=<todayKey>' in a useEffect keyed on todayKey (runs once per mount/day-rollover, self-healing any stale value). page.tsx reads it via next/headers cookies(), validates the YYYY-MM-DD shape, and uses it as serverTodayKey instead of utcTodayKey() when present; falls back to UTC otherwise (first-ever visit, cookies blocked, etc.) -- identical to the previous behavior in that fallback case, so no regression there. The doneSince cutoff (also using utcTodayKey()) was left untouched -- that one is intentionally UTC-anchored to match the DB's finalize_iteration convention, a separate concern.

Verified live (current dev-machine local time is JST, already past the 09:00 boundary, so the real mismatch window wasn't observable today -- verified the underlying mechanism directly instead): set document.cookie to a deliberately wrong 'local_date=2099-01-01', reloaded, and confirmed via the raw SSR response (fetched with credentials) that serverTodayKey came through as '2099-01-01' -- proving page.tsx genuinely reads and trusts the cookie. Reloaded again and confirmed the cookie self-healed back to the real local date ('2026-07-23') after the client mount effect ran, with serverTodayKey matching on the next fetch. tsc/eslint/vitest (116 tests) all green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed by seeding serverTodayKey from a client-maintained 'local_date' cookie (read in page.tsx via next/headers) instead of always using UTC, with the client (my-work-sections.tsx) keeping that cookie fresh via a useEffect. Falls back to UTC exactly as before when the cookie is absent (first visit), so no regression. Verified the read/write/self-heal round-trip end-to-end via a deliberately-wrong cookie value showing up in and then correcting out of the raw SSR response, since the real UTC/JST mismatch window (00:00-09:00 JST) wasn't reproducible live at verification time.
<!-- SECTION:FINAL_SUMMARY:END -->
