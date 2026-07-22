---
name: advisor
description: Consult the fable-advisor agent for a design/plan review. Use when the user types /advisor, says アドバイザーに聞いて / Fableに確認 / セカンドオピニオン, or proactively BEFORE implementing a large plan (new tables/RLS, board algorithm rewrites, concurrency-sensitive changes, cross-cutting refactors) instead of asking the user to review the plan.
---

# Advisor consultation

Spawn the `fable-advisor` agent (Agent tool, `subagent_type: fable-advisor`,
synchronous) with **one focused question**.

Package the prompt as:

1. **The question** — one decision to make ("この計画で進めてよいか", "A案とB案
   どちらか"), not "review everything".
2. **Context** — current Backlog task id, your plan or a diff summary, the
   files you intend to touch.
3. **What you already checked** — spec sections read, tests run, related
   tasks looked at.

Rules:

- Keep the prompt under ~40 lines. The advisor reads the repo itself — do
  not paste whole files.
- Fable time is metered on the user's plan: batch related sub-questions
  into one consultation instead of spawning repeatedly. Do not use the
  advisor for questions AGENTS.md or the spec already answers.
- Relay the advisor's verdict to the user (verbatim conclusion + key
  corrections) before acting on it.
- If the verdict changes a spec or Backlog task, you make those edits per
  its instructions — the advisor never writes.
- If the `fable` model is unavailable (plan window closed), rerun the same
  Agent call with `model: opus` and tell the user the advisor ran on Opus.
