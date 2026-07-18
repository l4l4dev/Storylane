# @storylane/mcp

An MCP server that lets coding agents (Claude Code and other MCP clients) read
and write Storylane projects. It is a third Supabase client alongside Web and
iOS — it talks to Supabase directly through RLS and the sanctioned RPCs, never
the Next.js server actions. See `spec/mcp.md` for the design.

## Agent-as-member model

The agent has no special powers. It signs in as an ordinary Supabase user (the
"bot") and every read/write is gated by the same RLS as any human member. There
is **no service-role key** in this server.

## One-time setup

### 1. Create the bot user

Create a Supabase auth user for the bot and a matching `profiles` row so humans
can tell it apart. Against a local stack you can do this with the service role
(e.g. in `supabase studio`, or the admin API):

- email: `agent@<your-domain>` · a strong password
- `profiles`: `username: claude-agent`, display name `Claude (agent)`

### 2. Invite the bot to a project

As the project **owner**, invite the bot with role `member` (the existing
`invite_member` RPC — e.g. via the members UI, or search the bot by username).
Role `member` is deliberate: `owner` would hand the bot deletion, settings and
archive powers. Uninviting it later revokes all access — there is no separate
token to rotate.

### 3. Configure credentials

```bash
cp apps/mcp/.env.local.example apps/mcp/.env.local
# then fill in SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL, AGENT_PASSWORD
```

`.env.local` is gitignored — never commit it.

### 4. Register the server in Claude Code

```bash
claude mcp add storylane -- pnpm --dir apps/mcp start
```

(`pnpm --dir apps/mcp start` runs `tsx src/index.ts`. `@storylane/core` ships as
a TypeScript-source workspace package, so the server runs under `tsx` rather
than Node type-stripping — see TASK-68.)

## Phase 1 tools

| Tool | Kind | Notes |
|---|---|---|
| `board_summary` | read | current iteration, points/counts by state, velocity, backlog/icebox counts |
| `list_stories` | read | filter by state, iteration, epic, label, text, or zone |
| `get_story` | read | description, tasks, comments, labels, recent activity |
| `create_story` | write | lands at the bottom of `backlog_bottom` \| `icebox` \| `current_iteration` |
| `update_story` | write | partial update of the passed fields only |
| `transition_story` | write | start / finish / deliver / accept / reject / restart |
| `move_story` | write | to the bottom of the current iteration, backlog, or icebox |
| `add_comment` | write | comment on a story |
| `set_story_tasks` | write | replace a story's checklist |
| `toggle_story_task` | write | mark one checklist item done / not-done |

Write tools reject archived projects.
Irreversible operations (deletes, iteration finalization, member management,
cross-project move/copy) are excluded from Phase 1.

Write tools that touch the current iteration first apply the lazy iteration
rollover, exactly as the Web client does. Slack notifications do **not** fire
for agent-driven changes yet (they still come only from the Web server actions
— spec/mcp.md).

## Tests

Integration tests run each tool's happy path and a permission-denied path
against a running local Supabase:

```bash
supabase start                       # from repo root, if not already running
SUPABASE_INTEGRATION=1 pnpm --dir apps/mcp exec vitest run
```

Without `SUPABASE_INTEGRATION=1` (and the seeded local dev user) the suite is
skipped.
