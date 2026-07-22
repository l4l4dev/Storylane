---
id: doc-16
title: 16 — My Work scenario regression walkthrough (run after every My Work task)
type: guide
created_date: '2026-07-22 11:26'
updated_date: '2026-07-22 11:26'
---
# My Work scenario regression walkthrough

Run this full script **after every My Work-related task completes**, before
marking it Done — it exists to catch "shipped but not actually working in
the flow" gaps (e.g. TASK-145: Today reordering marked Done while
unimplemented). It is a manual walkthrough by the owner; agent sessions
link it from kakunin-tejun steps rather than re-deriving checks.

Friction-log convention (structured dogfooding, owner decision
2026-07-22): while using My Work for real daily planning, record every
point of friction *as a personal task in My Work itself*, title prefixed
`[friction]`. Triage the collected `[friction]` tasks together at the end
of each week and convert the keepers into Backlog tasks.

## Preconditions

- Local stack: `supabase start` + `pnpm dev`, signed in via "Continue as
  dev user".
- At least one **team** project where the dev user is a member, plus the
  auto-created personal "My Tasks" project (invisible — that's the point).
- To simulate "yesterday" without waiting a day (steps C1-C3), age a
  Today mark directly:
  `update my_work_story_state set today_date = current_date - 1 where story_id = '<id>';`

## A. Personal task lifecycle

| # | Step | Expected |
|---|------|----------|
| A1 | My Work → "Add a personal task", title only, save | Card appears in **Todo**, grouped under the personal project, assigned to you. No iteration/points asked |
| A2 | Drag it Todo → Today | Card moves to Today and stays after reload |
| A3 | Add a second personal task, drag to Today, then reorder the two inside Today | Order changes persist across reload (today_position) |
| A4 | Drag one to a free column (e.g. Doing) | Moves; project board state untouched notion — no error |
| A5 | Drag it to **Done** | Appears as a Done log entry (date-grouped, completion marker). This is a real completion: reload → still in Done |
| A6 | Drag the Done entry back to **Todo** | Reopens: card back in Todo AND the Done log entry from A5 **remains** (additive log — never disappears) |
| A7 | Complete it again (drag to Done) | A **second** Done entry exists alongside the first |
| A8 | Open the personal task's detail page | Checklist, comments, description, Move to project available. **No** estimate/points, iteration, epic selector, Promote to Epic (TASK-147) |
| A9 | From detail, "← Board"-equivalent back navigation | Lands on /my-work, never on a /projects/... page of the hidden project |

## B. Team stories in My Work

| # | Step | Expected |
|---|------|----------|
| B1 | On a team project's board, assign a story to yourself | It appears in My Work **Todo** with its real state badge |
| B2 | Drag it to Today / a free column | Moves locally; the team project's board state is **unchanged** (verify on the board) |
| B3 | Complete that story **on its own board** (done-category state) | A Done log entry appears in My Work automatically |
| B4 | Reassign the story to someone else | It leaves Todo/Today; any Done entries you earned **stay** |
| B5 | Drag a real-done team story's Done entry toward Todo | Rejected with a visible message (reopen happens on its board, not here) |

## C. Day boundary & carry-over

| # | Step | Expected |
|---|------|----------|
| C1 | Age a Today mark to yesterday (see Preconditions), reload My Work | Carry-over prompt: "carry over N items to today?" with the correct count |
| C2 | Accept for one item, decline for another | Accepted → Today (today's date); declined → falls back to its column/Todo. No re-prompt on reload |
| C3 | **JST 0:00–9:00 window** (or set the OS clock into it): reload and check Today | "Today" follows your local calendar date, not UTC (no premature rollover at 9:00, none missed at 0:00) |

## D. Columns

| # | Step | Expected |
|---|------|----------|
| D1 | Add a free column, rename it, drag cards into it | All work; placement survives reload |
| D2 | Delete that free column while it holds cards | Cards fall back to **Todo**, no error, nothing lost |
| D3 | Reorder columns (drag the column header once TASK-148 lands) | New order persists; grabbing a **card** never moves a column and vice versa |

## E. Isolation & concurrency

| # | Step | Expected |
|---|------|----------|
| E1 | Type a /projects/<personal-id>/... URL directly (board, iterations, settings) | Redirected to /my-work (TASK-147). Dev builds: the labeled Debug entry is the only way in |
| E2 | Open My Work in two tabs; drag a card in tab 1; reload tab 2 | Tab 2 shows the new placement; no snap-backs or duplicated cards |
| E3 | Sidebar / dashboard / project switcher | "My Tasks" appears nowhere |
