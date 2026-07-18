-- TASK-90: distinguish coding-agent profiles in collaboration UI.
-- This flag is presentation metadata only; agents keep the same RLS role and
-- capacity treatment as human members.

alter table public.profiles
  add column is_agent boolean not null default false;

-- Backfill the bot identity documented by spec/mcp.md and apps/mcp/README.md.
update public.profiles
set is_agent = true
where username = 'claude_agent';

-- RLS policies intentionally remain unchanged: the flag grants no privileges.
-- But the flag is a trust signal, so users must not set it on themselves: the
-- self-update policy (20260627000001) has no column list and the table-level
-- UPDATE grant (20260630000002) extends to new columns, so without this any
-- authenticated user could badge themselves as an agent (or the bot could
-- un-badge itself). A column-level REVOKE cannot carve columns out of a
-- table-level grant, so replace the table grant with an explicit column list
-- (id/created_at/is_agent stay service-role-only; future columns are locked
-- by default until granted here).
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, username) on public.profiles to authenticated;

-- DOWN
-- alter table public.profiles drop column is_agent;
