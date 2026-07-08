-- ============================================================
-- Task 9: iteration_goals — goals for future (virtual) iterations, which
-- have no `iterations` row yet (see spec/velocity.md "Virtual-group
-- computation"). Edited inline on the Backlog's virtual-iteration group
-- headers (spec/screens.md "Backlog groups"); adopted into `iterations.goal`
-- and deleted when rollover/manual finish creates the real row for that
-- number (spec/velocity.md "Rollover").
-- ============================================================

create table public.iteration_goals (
  project_id uuid not null references public.projects (id) on delete cascade,
  number     int  not null,
  goal       text not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, number)
);

alter table public.iteration_goals enable row level security;

-- Exception to the usual owner-only-delete pattern (spec/rls.md 2026-07-08):
-- a row here is a *field value* (the draft goal for a not-yet-real
-- iteration), not a record — deleting it is equivalent to clearing the
-- goal, which members can already do for a real iteration via
-- `iterations.goal` UPDATE (updateIterationGoal). Owner-only delete would
-- silently no-op a member's "clear the goal" action, since RLS filters
-- DELETE rows rather than erroring.
create policy "members can view iteration goals"
  on public.iteration_goals for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create iteration goals"
  on public.iteration_goals for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update iteration goals"
  on public.iteration_goals for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can delete iteration goals"
  on public.iteration_goals for delete to authenticated
  using (public.project_role(project_id) in ('owner', 'member'));

-- Enforces `number > project's current iteration number` (spec/data-model.md:
-- "virtual iteration number (> current iteration's number)") at the DB layer
-- rather than in each client (Web/iOS both write this table) — a stale
-- client that hasn't noticed a rollover yet must not be able to write a
-- goal for an already-real iteration number, where it would never be read
-- back by the UI (which only shows goals for numbers above current) and
-- would sit as a silently orphaned row.
--
-- security definer is not strictly required here (unlike assign_story_number
-- in 20260707000004 — anyone who can reach this trigger already passed the
-- iteration_goals owner/member check, which implies project membership and
-- thus ordinary SELECT access to `iterations` in the same project); kept
-- anyway as defense-in-depth against this trigger's read ever outliving a
-- future, stricter `iterations` SELECT policy.
--
-- Known gap (rls-security-reviewer, 2026-07-08): this check reads
-- `max(iterations.number)` without any lock, so a goal write can still race
-- a concurrent rollover/manual-finish that hasn't committed its new
-- `iterations` row yet, landing on the same number it's about to take.
-- Closing this needs the same advisory lock as the finalization path
-- (spec/velocity.md "Finalization concurrency & permissions"), which
-- doesn't exist until Task 10's SECURITY DEFINER RPC — adding a lock only
-- here, with `ensureCurrentIteration` (board/actions.ts) still unlocked,
-- wouldn't actually close the race. Accepted as temporary, closed by Task 10.
create or replace function public.check_iteration_goal_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number <= coalesce(
    (select max(number) from public.iterations where project_id = new.project_id), 0
  ) then
    raise exception 'iteration_goals.number must be greater than the current iteration number';
  end if;
  return new;
end;
$$;

create trigger iteration_goals_check_number
  before insert or update on public.iteration_goals
  for each row execute function public.check_iteration_goal_number();

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger iteration_goals_check_number on public.iteration_goals;
-- drop function public.check_iteration_goal_number();
-- drop table public.iteration_goals;
