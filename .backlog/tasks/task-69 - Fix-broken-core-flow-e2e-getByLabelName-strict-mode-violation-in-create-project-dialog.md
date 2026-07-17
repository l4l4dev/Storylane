---
id: TASK-69
title: >-
  Fix broken core-flow e2e: getByLabel('Name') strict-mode violation in
  create-project dialog
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-17 11:52'
updated_date: '2026-07-17 13:14'
labels:
  - web
  - bug
  - e2e
dependencies: []
priority: low
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
e2e/core-flow.spec.ts fails at step 2 (project creation) before even reaching
the Start-button/transition steps: `page.getByLabel("Name").fill(projectName)`
now hits a strict-mode violation because it matches TWO elements.

getByLabel does case-insensitive substring matching by default, and the
create-project dialog now also renders a member-invite field with
aria-label="Add member by exact username" — "username" contains "name" as a
substring, so both inputs match.

Confirmed unrelated to any other change (reproduces on main with a clean
`git stash`, i.e. pre-existing). Fix by making the e2e selector specific
(e.g. `page.getByRole("textbox", { name: "Name", exact: true })`, which is
what Playwright's own error output resolved it to) — do not rename the
production aria-label, only tighten the test selector.

Run: `pnpm --dir apps/web exec playwright test e2e/core-flow.spec.ts` to
reproduce/verify (requires local Supabase running + dev user seeded).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-17 implemented (Haiku 4.5): Fixed the strict-mode violation in line 15 by changing getByLabel("Name") to getByRole("textbox", { name: "Name", exact: true }). The selector error is gone — the test now progresses past the project-creation dialog and reaches line 20 (opening the project link).

However, a NEW failure appears at line 20: the project-creation redirect times out (120s timeout waiting for the project link to appear in the dashboard). This is a separate bug in the project-creation logic itself, not the selector. Left as a follow-up — unclear whether it's a recent regression or a persistent flake; needs investigation. Recommend checking createProject action / createClient behavior / local Supabase state if the next session hits it again.

2026-07-17 resolved (follow-up): the 120s redirect timeout had two causes, both fixed. (1) The test still expected the pre-TASK-32 flow (redirect back to /dashboard + click the project link); createProject has redirected straight to the new board since TASK-32 — updated the expectation (commit follows ff1716a). (2) The local DB had been wiped by a review-agent db reset without seed, so the dev-user login failed; restored with supabase db reset (seed applied). Verified: e2e/core-flow.spec.ts passes in 10.1s.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tightened the create-project selector to getByRole textbox exact (ff1716a) and fixed the stale post-TASK-32 redirect expectation; core-flow e2e verified green against freshly seeded local Supabase.
<!-- SECTION:FINAL_SUMMARY:END -->
