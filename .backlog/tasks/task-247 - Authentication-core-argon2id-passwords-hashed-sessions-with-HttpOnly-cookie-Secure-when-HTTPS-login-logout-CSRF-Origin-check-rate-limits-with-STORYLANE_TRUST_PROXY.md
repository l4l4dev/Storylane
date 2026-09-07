---
id: TASK-247
title: >-
  Authentication core: argon2id passwords, hashed sessions with HttpOnly cookie
  (Secure when HTTPS), login/logout, CSRF Origin check, rate limits with
  STORYLANE_TRUST_PROXY
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-09-07 02:55'
labels: []
milestone: m-9
dependencies:
  - TASK-246
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: high
type: feature
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc §4. Bun.password (argon2id, explicit params) for hashing; session id = 256-bit random, stored SHA-256 hashed, cookie HttpOnly SameSite=Lax, Secure only when the request is HTTPS (STORYLANE_BASE_URL https or trusted X-Forwarded-Proto), absolute + idle expiry, new id on login, server-side delete on logout, revoke all on password change. POST /api/auth/login, POST /api/auth/logout, GET /api/me. actorOf resolves the cookie to an Actor (disabled users → 401). CSRF: cookie-authenticated non-GET requires Origin (or Sec-Fetch-Site) matching the instance origin and Content-Type application/json, else 403. Rate limit login per IP and per email; client IP from X-Forwarded-For only when STORYLANE_TRUST_PROXY=true. Uniform login failure message. No SMTP.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Login sets a cookie without Secure on http://192.168.x.x and with Secure behind X-Forwarded-Proto https + trust proxy (tests)
- [ ] #2 Session ids are never stored in clear; logout invalidates; password change revokes all sessions (tests)
- [ ] #3 Non-GET with a foreign Origin or non-JSON content type is 403 for cookie auth (tests); route matrix covers /api/auth/* and /api/me with the 'public'/'self' rules
- [ ] #4 Rate limiter blocks after N failures per IP and per email and honours trust-proxy setting (tests)
- [ ] #5 authz-reviewer pass recorded in notes
<!-- AC:END -->
