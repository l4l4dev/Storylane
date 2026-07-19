-- ============================================================
-- TASK-91 (doc-8 §2): project_states — per-project custom board columns on
-- fixed categories. Supersedes the free-mode custom_statuses table (TASK-84
-- dropped it; this is a fresh table, not a rename/reuse, per the owner's
-- explicit instruction).
--
-- category is the system-semantics anchor (unstarted/in_progress/done/
-- rejected); name/action_label/position are freely editable, category is
-- NOT. action_label is the single advance-button verb for a plain forward
-- move (e.g. "Start", "Finish") — NULL means no button (a done-category
-- state has nothing to advance to). The Accept/Reject pair (on the state
-- immediately before a done-category state) and Restart (on a
-- rejected-category state) are FIXED UI vocabulary computed by
-- packages/core from category+position, not stored here — action_label
-- only ever supplies the "Accept"-shaped half of a pair, never "Reject" or
-- "Restart" (see packages/core's advance-computation for the exact rule).
--
-- RLS follows the removed custom_statuses' shape (members SELECT/INSERT/
-- UPDATE, owner-only DELETE) per spec/rls.md.
-- ============================================================

create table public.project_states (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  action_label text,
  category     text not null check (category in ('unstarted', 'in_progress', 'done', 'rejected')),
  position     int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (id, project_id) -- composite target for stories.state_id (TASK-91 next migration)
);
create index project_states_project_id_idx on public.project_states (project_id);

alter table public.project_states enable row level security;

create policy "members can view project states"
  on public.project_states for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create project states"
  on public.project_states for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update project states"
  on public.project_states for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete project states"
  on public.project_states for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- Category is immutable after creation — recategorize = create a new state
-- and move stories (doc-8 §2 advisor). Matches this repo's existing
-- reject_done_iteration_assignment style (BEFORE UPDATE ... WHEN, RAISE).
create or replace function public.reject_project_state_category_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'A state''s category cannot be changed after creation — create a new state and move stories instead'
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.reject_project_state_category_change() from public, authenticated;

create trigger project_states_reject_category_change
  before update on public.project_states
  for each row
  when (new.category is distinct from old.category)
  execute function public.reject_project_state_category_change();

-- Enforces >=1 unstarted-category and >=1 done-category state per project at
-- all times, so a project can always receive and complete work. AFTER
-- DELETE (not BEFORE): a BEFORE trigger computing "remaining count" during a
-- multi-row DELETE double-counts rows the statement hasn't removed yet,
-- while AFTER sees the post-delete state directly per row.
--
-- Concurrency: two callers each deleting a different one of the last two
-- done-category states race under READ COMMITTED unless serialized — each
-- transaction's count would see the other's not-yet-committed delete as
-- "still there" and both would pass. A per-project advisory lock taken
-- BEFORE the count closes this: the second caller blocks until the first
-- commits, then its count (a fresh READ COMMITTED snapshot per statement)
-- correctly sees the first deletion and raises. Lock key is dedicated
-- (not shared with iteration_finalize / positions / story_number) since
-- state deletion has no relationship to those.
--
-- Must short-circuit when the OWNING PROJECT is itself being deleted:
-- project_states is ON DELETE CASCADE from projects, so deleting a project
-- fires this trigger once per cascaded state row — without an early exit,
-- the last state(s) deleted by the cascade would raise and deleting a
-- project with any states (i.e. every real project) would be impossible.
create or replace function public.enforce_project_states_minimums()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_unstarted_count int;
  v_done_count int;
begin
  if not exists (select 1 from public.projects where id = old.project_id) then
    return null; -- project itself is gone (cascade delete) — nothing to enforce
  end if;

  perform pg_advisory_xact_lock(hashtext('project_states:' || old.project_id::text));

  select
    count(*) filter (where category = 'unstarted'),
    count(*) filter (where category = 'done')
    into v_unstarted_count, v_done_count
    from public.project_states
    where project_id = old.project_id;

  if v_unstarted_count = 0 then
    raise exception 'A project must always have at least one unstarted-category state' using errcode = 'P0001';
  end if;
  if v_done_count = 0 then
    raise exception 'A project must always have at least one done-category state' using errcode = 'P0001';
  end if;

  return null;
end;
$$;

revoke execute on function public.enforce_project_states_minimums() from public, authenticated;

create trigger project_states_enforce_minimums
  after delete on public.project_states
  for each row
  execute function public.enforce_project_states_minimums();

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger project_states_enforce_minimums on public.project_states;
-- drop function public.enforce_project_states_minimums();
-- drop trigger project_states_reject_category_change on public.project_states;
-- drop function public.reject_project_state_category_change();
-- drop table public.project_states;
