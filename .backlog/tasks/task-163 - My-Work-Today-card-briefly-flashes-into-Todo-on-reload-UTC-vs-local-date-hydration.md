---
id: TASK-163
title: >-
  My Work: Today card briefly flashes into Todo on reload (UTC vs local date
  hydration)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 22:24'
updated_date: '2026-07-22 22:24'
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
- [ ] #1 Reloading /my-work during the UTC/local-date mismatch window no longer shows a Today card in Todo, even briefly
- [ ] #2 No regression to the existing UTC-seed/local-correct pattern for viewers where server and local date already agree
- [ ] #3 Approach verified against this Vercel deployment before relying on it (see notes) -- if the assumption doesn't hold, propose a fallback before implementing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposed fix approach (not yet implemented, pending owner go-ahead, needs verification first): Vercel forwards a request geolocation header (x-vercel-ip-timezone, an IANA timezone string) to serverless/edge functions when available. If page.tsx can read it (via next/headers) and compute the viewer's local date server-side, the first paint could already use the correct local date -- no flash, no new dependency (native platform feature already in use per CLAUDE.md's Vercel hosting), graceful fallback to the current utcTodayKey() behavior when the header is absent. UNVERIFIED: whether this header is actually populated on this project's Vercel plan/deploy config -- must confirm empirically (e.g. log headers() in a route handler on the deployed app) before committing to this approach; if unavailable, need a different plan (e.g. a client-set cookie of the last-known local date, read on the next SSR pass) -- more moving parts, second choice.
<!-- SECTION:NOTES:END -->
