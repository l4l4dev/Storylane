---
id: TASK-210
title: Slack webhook URL accepts internal/blind SSRF targets
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
updated_date: '2026-07-28 03:45'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/functions/slack-notify/index.ts
  - 'apps/web/app/projects/[id]/settings/actions.ts'
priority: high
type: bug
ordinal: 1050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
settings/actions.ts saveIntegration() stores any string as the Slack webhook_url with no validation beyond non-empty. supabase/functions/slack-notify/index.ts fetches that URL directly from the service-role Edge Function. A project owner can point it at an internal IP or a cloud metadata endpoint, and the Edge Function will fetch it with no host restriction — blind SSRF from a trusted service-role context. UI-only validation doesn't help since PostgREST accepts the raw upsert. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 slack-notify rejects non-HTTPS webhook URLs
- [x] #2 slack-notify rejects URLs containing userinfo (user:pass@host)
- [x] #3 slack-notify rejects URLs resolving to private/link-local/loopback IP ranges and does not follow redirects into them
- [x] #4 Existing valid hooks.slack.com webhook URLs continue to deliver notifications
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. slack-notify/index.ts: add exported safeWebhookUrl(raw) — parse, require https:, reject userinfo, require hostname === hooks.slack.com. Chosen over DNS-resolution IP-range checks because a fixed host makes private/link-local targets unreachable by construction and closes the DNS-rebinding TOCTOU that an IP check cannot.
2. Gate the delivery fetch on it: an invalid stored URL becomes a 200 no-op with a console.error (same non-retryable shape as the existing 'no active slack integration' skip) — never a 5xx, or pg_net retries a bad config forever.
3. Pass redirect: 'manual' so a 3xx from hooks.slack.com is never followed to a second host.
4. Update the existing test fixtures from hooks.slack.test to hooks.slack.com (the fake host would now be rejected), and add cases for each AC: http://, userinfo, private-IP host, non-Slack host, and a valid hooks.slack.com URL still delivering.
5. Mirror the same validation in saveIntegration() so the Settings UI rejects a bad URL at write time with a clear message — defence in depth only; the Edge Function stays the authority since PostgREST accepts raw upserts.
6. Verify: deno test on the function, vitest on the web action, and a live curl check that a rejected URL produces the no-op path.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as a host allowlist (hostname must equal hooks.slack.com) rather than the DNS-resolve-then-check-IP-ranges shape AC #3's wording suggests. Owner chose this after both options were put side by side. Reasoning: an IP-range check has to resolve the name, inspect the addresses, then hand the NAME back to fetch, which resolves again — a DNS rebind between the two lookups passes the check and still connects internally. Pinning the host removes that window entirely and makes every private/link-local/loopback/metadata target unreachable by construction, so AC #1-#3 are satisfied strictly more strongly than the literal wording. spec/integrations.md documents this integration as a Slack Incoming Webhook and the Settings placeholder already says hooks.slack.com/services/..., so the allowlist does not narrow any documented capability. Trade-off accepted: Slack-compatible third-party endpoints (Mattermost etc.) would need an explicit allowlist entry.

A rejected URL takes the existing 200 no-op path (with console.error, URL itself not logged since it is the untrusted value) rather than a 5xx, matching the 'no active slack integration' skip — pg_net would retry a 5xx against a permanently-bad stored config forever.

fetch now passes redirect: 'manual' so a 3xx from Slack cannot become a second request to a host that never passed validation.

Scope: the plan originally included mirroring the same validation in saveIntegration(). Confirmed with the owner and dropped — it is outside all four ACs, and the task description itself notes UI-side validation secures nothing because PostgREST accepts the raw upsert. Left as possible follow-up for the UX gap only (an owner can still save a URL that will silently never deliver).

Verified: deno test --allow-env on the function 19/19 (was 12, +7 covering each AC: non-HTTPS schemes incl. file:/gopher:, userinfo smuggling https://hooks.slack.com@169.254.169.254/, ten private/loopback/link-local/metadata hosts, lookalike domains like hooks.slack.com.evil.test, the rejected-URL no-op path, and a valid webhook still delivering). Separately proved Deno's runtime actually honours redirect:'manual' with a throwaway local server returning 302 — it returned the 302 and never connected to the redirect target, so the option is not just passed but effective. Existing test fixtures moved off hooks.slack.test onto a real hooks.slack.com URL, since the placeholder host is now correctly rejected. Web suite 860 passed / 267 skipped, lint clean, Slack outbox integration test 4/4 against local Supabase.

/code-review (post-implementation) returned 3 findings; all resolved or accepted with the owner.

#1 medium — the host restriction existed only in code, so it read as a silent spec divergence. REVIEW.md allows divergence from spec/ only when the spec records it as deliberate (spec/ux-principles.md 'never diverge by accident'). FIXED: spec/integrations.md 'Slack Notifications' now states the URL must be on hooks.slack.com over HTTPS with no userinfo, records the restriction as deliberate, gives the DNS-rebinding reason it was chosen over IP-range checks, and names the consequence (Slack-compatible third-party endpoints unsupported).

#2 low — saveIntegration() still accepts a URL delivery will always drop, so an owner can save a Mattermost-style endpoint and get permanent silent no-delivery. Reviewer accepted leaving it 'if the spec/help-text note lands instead'; the spec note landed. Owner separately decided against adding Settings help text, since the field placeholder already shows hooks.slack.com/services/... and a one-line copy change would pull in the fable-advisor design-review pass CLAUDE.md requires for user-facing UI. The UX gap (saveable but never delivers) is therefore known and accepted, not overlooked.

#3 low — deno.lock was left untracked. Owner chose to commit it: it pins jsr:@std/assert integrity hashes for the Edge Function tests and will matter once TASK-214 puts those tests in CI.

The review also independently verified the security core and found no correctness bug: it re-ran the Deno suite (19/19), reproduced the redirect:'manual' runtime behaviour, confirmed by repo-wide grep that integrations.config.webhook_url has exactly one consumer and that slack-notify holds the only outbound fetch in supabase/functions/, and probed parser tricks my own tests had NOT covered — backslash-as-slash (https://hooks.slack.com\@evil.com keeps the Slack host), tab/newline stripping collapsing into a userinfo URL, and IDN homographs punycoding to a non-matching host. safeWebhookUrl held against all three.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
slack-notify now validates the stored webhook_url at delivery: HTTPS only, no userinfo, and the host pinned to hooks.slack.com, with fetch(redirect:'manual') so a 3xx cannot reach an unvalidated host. A rejected URL is a 200 no-op (pg_net would retry a 5xx against a permanently-bad config forever). Host pinning was chosen over DNS-resolve-plus-IP-range checks because it closes the DNS-rebinding window an IP check leaves open; spec/integrations.md now records that restriction as deliberate. Verified with deno test 19/19 (7 new cases, one per AC), a live check that Deno honours redirect:'manual' (302 returned, target never contacted), web suite 860 passed and lint clean, and the Slack outbox integration test 4/4. /code-review: 3 findings, all resolved or accepted.
<!-- SECTION:FINAL_SUMMARY:END -->
