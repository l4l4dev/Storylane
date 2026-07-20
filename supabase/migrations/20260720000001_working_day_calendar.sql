-- ============================================================
-- TASK-85 (doc-8 §6): working-day calendar — project default weekdays plus
-- two date-exception layers (project-level closures/extra days, per-user
-- time off).
--
-- These feed velocity/capacity math ONLY (spec/velocity.md). They never move
-- iteration boundaries; the single exception is 1-day cadence start-date
-- selection (TASK-87), which consults the PROJECT calendar only — user time
-- off must never make an iteration exist for one member and not another.
-- ============================================================

-- ISO weekday numbers (1=Mon .. 7=Sun). At least one working day is required:
-- capacity math and TASK-87's 1-day start-date selection both need somewhere
-- to land, and the anon key lets an owner PATCH this column directly, so the
-- invariant cannot live in the server action alone. Duplicate entries are not
-- rejected here (no immutable single-row expression does it); capacity math
-- must treat the array as a set.
alter table public.projects
  add column working_weekdays int[] not null default '{1,2,3,4,5}'
    check (working_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]
           and cardinality(working_weekdays) > 0);

-- ------------------------------------------------------------
-- project_calendar_exceptions — per-project date overrides.
-- holiday       = a normally-working day that isn't (company closure)
-- extra_workday = a non-working weekday made working
-- ------------------------------------------------------------
create table public.project_calendar_exceptions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('holiday', 'extra_workday')),
  unique (project_id, date)
);

alter table public.project_calendar_exceptions enable row level security;

create policy "members can view calendar exceptions"
  on public.project_calendar_exceptions for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create calendar exceptions"
  on public.project_calendar_exceptions for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update calendar exceptions"
  on public.project_calendar_exceptions for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can delete calendar exceptions"
  on public.project_calendar_exceptions for delete to authenticated
  using (public.project_role(project_id) in ('owner', 'member'));

-- project_id is immutable, same guard project_states carries. A user who is
-- owner/member in two projects could otherwise UPDATE ... SET project_id and
-- teleport an exception between them, keeping its id and created_at. That
-- grants no access the delete+insert path doesn't already give them, but it
-- makes the move invisible, so the row can only ever be removed and recreated.
create or replace function public.reject_calendar_exception_reparent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'A calendar exception cannot be moved to a different project — remove it and add one there instead'
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.reject_calendar_exception_reparent() from public, authenticated;

create trigger project_calendar_exceptions_reject_reparent
  before update on public.project_calendar_exceptions
  for each row
  when (new.project_id is distinct from old.project_id)
  execute function public.reject_calendar_exception_reparent();

-- ------------------------------------------------------------
-- user_time_off — per-user, CROSS-PROJECT (one absence applies everywhere
-- the user works). Dates + kind only, deliberately no reason/notes column:
-- co-members must read these rows for capacity math, so the table is built
-- to carry nothing private (doc-8 §6). The accepted trade-off — sharing any
-- project exposes your time-off dates to that project's members, viewers
-- included — is documented in spec/rls.md.
--
-- kind is a single-value check today rather than a bare marker table so a
-- later kind ('half_day') is an ALTER, not a schema change at every reader.
-- ------------------------------------------------------------
create table public.user_time_off (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('off')),
  primary key (user_id, date)
);

alter table public.user_time_off enable row level security;

create policy "time off is visible to self and co-members"
  on public.user_time_off for select to authenticated
  using (user_id = auth.uid() or public.shares_project_with(user_id));

create policy "users manage their own time off"
  on public.user_time_off for insert to authenticated
  with check (user_id = auth.uid());

create policy "users update their own time off"
  on public.user_time_off for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users delete their own time off"
  on public.user_time_off for delete to authenticated
  using (user_id = auth.uid());

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger project_calendar_exceptions_reject_reparent on public.project_calendar_exceptions;
-- drop function public.reject_calendar_exception_reparent();
-- drop table public.user_time_off;
-- drop table public.project_calendar_exceptions;
-- alter table public.projects drop column working_weekdays;
