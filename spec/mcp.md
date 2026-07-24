# MCP Server (agent access)

Lets coding agents (Claude Code and other MCP clients) read and write Storylane
projects, so development work can eventually be managed in Storylane itself
(dogfooding). Designed 2026-07-11 (TASK-47); implemented in TASK-48.

## Placement

- TypeScript package `apps/mcp` in the monorepo, stdio transport.
- Registered per machine: `claude mcp add storylane -- pnpm --dir apps/mcp start`.
- Talks to Supabase directly with `@supabase/supabase-js`, exactly like the iOS
  repository layer does. It does NOT call the Next.js server actions — the shared
  contract between clients is the Supabase schema + RLS + RPCs (see
  ARCHITECTURE.md), and the MCP server is simply a third client.

## Agent-as-member model

Agents get no special powers. An agent is an ordinary Supabase user:

- A dedicated bot login (e.g. `agent@<owner-domain>`), its `profiles` row named so
  humans can tell it apart (`username: claude_agent`, display name "Claude (agent)")
  and flagged **`is_agent = true`** (doc-8 §8) so UIs can badge it apart from
  humans. Capacity math still treats it exactly like a human via the working-day
  calendar.
- The owner invites it to a project via the existing `invite_member` RPC with role
  `member`. Uninviting it revokes all access — no separate token lifecycle.
- Every write flows through existing RLS policies and sanctioned RPCs. The server
  never holds the service-role key. `activity_logs` triggers attribute actions to
  the bot profile automatically, so agent activity is auditable like anyone else's.

### Auth decision

Credentials live in `apps/mcp/.env.local` (never committed): `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `AGENT_EMAIL`, `AGENT_PASSWORD`. On startup the server signs
in with password auth and lets supabase-js manage token refresh in memory.

Why not the alternatives:
- **Service-role key + app-side scoping** — rejected: bypasses RLS, one bug away
  from cross-project writes, and loses per-agent attribution.
- **Personal-access-token table + verification RPC** — rejected for Phase 1: new
  table, new RLS surface, and custom token checking for no gain at single-user
  scale. Revisit only if agents ever need scoped/expiring credentials.

## Phase 1 toolset

Read:
- `board_summary(project_id)` — current iteration (number, dates, goal, state),
  points by state (with category), `velocity_points_per_person_day` (TASK-101:
  points earned per person-day of capacity, averaged over the velocity window
  — a rate, typically well below 1, e.g. `0.8`; NOT a per-sprint point total —
  the old field, named `velocity` then renamed to `velocity_rate` with no
  transition period by TASK-86, carried exactly this ambiguity, which is why
  the field is named for its unit now instead of shipping a compatibility key
  a stale reader could only ever misinterpret), backlog/icebox counts.
- `list_stories(project_id, filter?)` — by state, iteration, parent (container),
  label, or text. Returns compact rows (id, title, type, state, points,
  parent_id, is_container, labels — doc-18).
- `get_story(story_id)` — full story: description, tasks, comments, labels,
  recent activity entries.

Write:
- `create_story(project_id, title, {description, story_type, points, parent_id,
  labels, destination})` — `parent_id` nests the new story under a container
  (doc-18; the single-level trigger rejects an illegal parent). destination:
  `backlog_bottom | icebox |
  current_iteration` (default `backlog_bottom`, matching spec/ux-principles.md
  principle 4's "predictable landing spot"). No `backlog_top` / arbitrary
  positions: an arbitrary insert would rewrite the dense `position` sequence
  across every row between the old and new spot, and a partial resequence
  (some rows rewritten, some not) corrupts the position-ordering invariant
  (spec/data-model.md) regardless of who is permitted to write — a
  reordering RPC belongs behind its own transaction + advisory lock, the
  same shape `_splice_backlog`/`swap_adjacent` already use, not a bare
  client-side loop of individual UPDATEs. Zone-bottom is `max(position)+1`
  and touches no other row. If arbitrary placement is ever needed, it
  becomes a SECURITY DEFINER resequence RPC in a later phase.
- `update_story(story_id, fields)` — title, description, points, labels,
  parent_id, assignee (`is_container` is read-only, never a writable field —
  doc-18). Partial UPDATE of exactly the passed fields (field-level
  last-write-wins per spec/screens.md), never a full-record write.
- `set_story_state(story_id, state_id)` — move a story to one of the project's
  `project_states` (doc-8 §2). **State-id addressing**, not lifecycle verbs: the
  DB allows any→any within the project, so the tool takes a target state id
  (or NULL for the Icebox), and the caller reads valid states from
  `board_summary`. Backed by the `set_story_state` Postgres RPC (replaces the
  old fixed-verb `transition_story`), which owns the shared guards — the
  unestimated-feature estimation gate (category terms), the done-iteration
  guard, and auto-assign to the current iteration on entering an `in_progress`
  state. Web's board is switched onto the same RPC.
- `move_story(story_id, destination)` — between current iteration, backlog,
  icebox; always lands at the bottom of the destination zone (no `position`
  parameter — same resequence reasoning as `create_story`).
- `add_comment(story_id, body)` / `set_story_tasks(story_id, tasks)` /
  `toggle_story_task(task_id, done)` — comments and checklist management (the
  Backlog.md "acceptance criteria" analog during dogfooding).

Excluded from Phase 1 (irreversible or out of scope): `finalize_iteration`,
story/project deletion, member management, cross-project move/copy, and
`project_states` column management (state creation/deletion has integrity
triggers — see spec/data-model.md — best left to the human-facing Settings UI
in Phase 1).

Tool errors must be self-explanatory (ux-principles.md applies to agents too): an
RLS denial surfaces as "the agent is not a member of this project — invite
<agent username> first", not a bare Postgres error.

## Write-path rules (advisor verdict 2026-07-11, TASK-47)

- **Row-count verification everywhere.** Member-role RLS now allows UPDATE on
  any story in the project (TASK-70, doc-8 §2 board write model — Pivotal-style,
  any member may operate any story), so a 0-row result is no longer the
  primary authorization gate; it is a residual defensive check for races —
  the story was deleted between the existence check and the write, or the
  caller's role was revoked mid-request (`project_role()` is re-evaluated per
  statement, the same class `transition_story`'s own `FOR UPDATE` re-check
  guards against). Every write tool still checks affected rows via `.select()`
  and turns 0 rows into an explicit error rather than a silent no-op (the
  TASK-22/26/31 failure class) — only the wording changed, not the discipline.
  Dogfooding rule: stories the agent manages are created by (or assigned to)
  the agent as a *convention*, not an RLS-enforced one. The bot stays role
  `member` — owner would hand it deletion, settings, and archive powers.
- **Lazy rollover first.** Any tool touching the current iteration
  (`board_summary`, `list_stories`, `move_story`, `create_story` →
  `current_iteration`) calls `finalize_iteration(p_manual: false)` before
  reading/writing, via ONE shared helper — the same obligation Web's
  `ensureCurrentIteration` fulfills (spec/velocity.md "Rollover"); never
  duplicated per tool.
- **Archive guard.** Write tools reject archived projects (`archived_at` set):
  MCP is exactly the REST path the TASK-30 gap leaves open. (The old
  `workflow_mode = 'tracker'` check is gone — free mode was removed, doc-8 §1.)
- **No side-effect duplication.** Slack notifications only fire from Next.js
  server actions today, so agent-driven changes (and MCP-triggered rollovers) do
  NOT notify Slack until TASK-24 moves notifications to a DB webhook. Do not
  reimplement `notifySlack` in the MCP server. If dogfooding needs notifications,
  propose pulling TASK-24 forward.
- **Shared pure logic.** State advance/category computation, velocity/capacity math, and other pure TS logic
  used by both Web and MCP is extracted to a shared workspace package (e.g.
  `packages/core`) and imported by both — never copy-pasted (decision-1's golden
  fixtures are for TS↔Swift; TS↔TS shares a package).
- **Multi-write tools are atomic via one RPC.** Any tool that does more than one
  write — checklist replace, label replace, create-with-labels — runs inside a
  single `SECURITY INVOKER` RPC (TASK-71), never as separate PostgREST requests
  (which have no shared transaction and can leave a half-applied state on
  failure). Positioned inserts consume the column's sequence DEFAULT; never write
  `position` explicitly (spec/data-model.md position invariant).

## Migration path from Backlog.md

1. TASK-48 lands the server; verify against local Supabase (`supabase start`).
2. Dogfooding trial (TASK-49): mirror active dev tasks into a Storylane
   project; run ONE full iteration managing them via MCP. Backlog.md remains the
   source of truth for the trial — divergence is logged, not fought.
3. Friction points become Storylane feature tasks; at iteration end the owner
   decides: switch, extend the trial, or stay on Backlog.md.

Field mapping for the trial: task title/description → story; acceptance criteria →
story tasks (checklist); implementation notes → comments; task status → story
state; assignee/model → story assignee (bot) + a `model:<name>` label.
