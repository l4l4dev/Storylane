---
id: TASK-69
title: >-
  Fix broken core-flow e2e: getByLabel('Name') strict-mode violation in
  create-project dialog
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-17 11:52'
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
