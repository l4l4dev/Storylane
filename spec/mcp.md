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
  humans can tell it apart (`username: claude-agent`, display name "Claude (agent)").
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
  points by lifecycle state, velocity, backlog/icebox counts.
- `list_stories(project_id, filter?)` — by state, iteration, epic, label, or text.
  Returns compact rows (id, title, type, state, points, epic, labels).
- `get_story(story_id)` — full story: description, tasks, comments, labels,
  recent activity entries.

Write:
- `create_story(project_id, title, {description, story_type, points, epic_id,
  labels, destination})` — destination: `backlog_bottom | icebox |
  current_iteration` (default `backlog_bottom`, matching spec/ux-principles.md
  principle 4's "predictable landing spot"). No `backlog_top` / arbitrary
  positions: reordering rewrites the dense `position` sequence across rows the
  member-role bot cannot UPDATE (partial resequence = TASK-20-class corruption).
  Zone-bottom is `max(position)+1` and touches no other row. If arbitrary
  placement is ever needed, it becomes a SECURITY DEFINER resequence RPC in a
  later phase.
- `update_story(story_id, fields)` — title, description, points, labels, epic,
  assignee. Partial UPDATE of exactly the passed fields (field-level
  last-write-wins per spec/screens.md), never a full-record write.
- `transition_story(story_id, action)` — lifecycle actions (start/finish/deliver/
  accept/reject...). Backed by a NEW `transition_story` Postgres RPC created in
  TASK-48: the unestimated-feature guard and the start-from-backlog
  current-iteration assignment (TASK-19) currently live only in the Web server
  action, so a direct UPDATE from a third client would bypass both. The RPC owns
  those rules; the existing done-iteration trigger stays as is. Web's
  `transitionStory` action is switched onto the same RPC in a follow-up task.
- `move_story(story_id, destination)` — between current iteration, backlog,
  icebox; always lands at the bottom of the destination zone (no `position`
  parameter — same resequence reasoning as `create_story`).
- `add_comment(story_id, body)` / `set_story_tasks(story_id, tasks)` /
  `toggle_story_task(task_id, done)` — comments and checklist management (the
  Backlog.md "acceptance criteria" analog during dogfooding).

Excluded from Phase 1 (irreversible or out of scope): `finalize_iteration`,
story/project deletion, member management, cross-project move/copy, free-mode
column management. Tracker mode only — free-mode tools come with a later phase if
dogfooding demands them.

Tool errors must be self-explanatory (ux-principles.md applies to agents too): an
RLS denial surfaces as "the agent is not a member of this project — invite
<agent username> first", not a bare Postgres error.

## Write-path rules (advisor verdict 2026-07-11, TASK-47)

- **Row-count verification everywhere.** Member-role RLS only allows UPDATE on
  stories the bot created or is assigned to; anything else is a silent 0-row
  no-op (the TASK-22/26/31 failure class). Every write tool checks affected rows
  via `.select()` and turns 0 rows into an explicit error ("the agent is not the
  author or assignee of this story"). Edge case: reassigning an assignee-only
  story to someone else is blocked by WITH CHECK — surface that clearly too.
  Dogfooding rule: stories the agent manages are created by (or assigned to) the
  agent. The bot stays role `member` — owner would hand it deletion, settings,
  and archive powers.
- **Lazy rollover first.** Any tool touching the current iteration
  (`board_summary`, `list_stories`, `move_story`, `create_story` →
  `current_iteration`) calls `finalize_iteration(p_manual: false)` before
  reading/writing, via ONE shared helper — the same obligation Web's
  `ensureCurrentIteration` fulfills (spec/velocity.md "Rollover"); never
  duplicated per tool.
- **Mode and archive guards.** Write tools verify `projects.workflow_mode =
  'tracker'` (explicit error otherwise — the TASK-28 webhook precedent) and
  reject archived projects (`archived_at` set): MCP is exactly the REST path the
  TASK-30 gap leaves open.
- **No side-effect duplication.** Slack notifications only fire from Next.js
  server actions today, so agent-driven changes (and MCP-triggered rollovers) do
  NOT notify Slack until TASK-24 moves notifications to a DB webhook. Do not
  reimplement `notifySlack` in the MCP server. If dogfooding needs notifications,
  propose pulling TASK-24 forward.
- **Shared pure logic.** State machine, velocity math, and other pure TS logic
  used by both Web and MCP is extracted to a shared workspace package (e.g.
  `packages/core`) and imported by both — never copy-pasted (decision-1's golden
  fixtures are for TS↔Swift; TS↔TS shares a package).

## Migration path from Backlog.md

1. TASK-48 lands the server; verify against local Supabase (`supabase start`).
2. Dogfooding trial (TASK-49): mirror active dev tasks into a tracker-mode
   project; run ONE full iteration managing them via MCP. Backlog.md remains the
   source of truth for the trial — divergence is logged, not fought.
3. Friction points become Storylane feature tasks; at iteration end the owner
   decides: switch, extend the trial, or stay on Backlog.md.

Field mapping for the trial: task title/description → story; acceptance criteria →
story tasks (checklist); implementation notes → comments; task status → lifecycle
state; assignee/model → story assignee (bot) + a `model:<name>` label.
