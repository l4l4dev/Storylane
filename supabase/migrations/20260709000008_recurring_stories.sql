-- ============================================================
-- TASK-16.4: Free mode recurring stories (KanbanFlow parity,
-- spec/screens.md "Recurring stories", spec/data-model.md
-- "recurring_stories"). Advisor-reviewed 2026-07-09.
--
-- Recurrence rules for free-mode boards, managed in Settings. Generation
-- is lazy on board access via the generate_recurring_stories RPC below
-- (no cron), following the same claim-then-insert shape as
-- finalize_iteration (spec/velocity.md "Finalization concurrency"), minus
-- the advisory lock: a single row's conditional UPDATE is enough here
-- since generation never chains across rows the way iteration rollover
-- chains across iterations.
-- ============================================================

create table public.recurring_stories (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  title            text not null,
  description      text,
  custom_status_id uuid,
  swimlane_id      uuid,
  cadence          text not null check (cadence in ('daily', 'weekly', 'monthly')),
  weekday          int check (weekday between 0 and 6),
  day_of_month     int check (day_of_month between 1 and 31),
  is_active        bool not null default true,
  last_generated_on date,
  created_at       timestamptz not null default now(),
  -- Otherwise the RPC hits weekday/day_of_month = NULL for a rule whose
  -- cadence needs one, an unspecified-behavior gap the spec's sketch
  -- doesn't rule out on its own — enforced here instead (decision-1:
  -- invariants live in the DB, not just the Settings form).
  constraint recurring_stories_weekly_needs_weekday check (cadence <> 'weekly' or weekday is not null),
  constraint recurring_stories_monthly_needs_day check (cadence <> 'monthly' or day_of_month is not null)
);
create index recurring_stories_project_id_idx on public.recurring_stories (project_id);

-- Composite FKs, same shape as stories' custom_status_id/swimlane_id
-- (blocks a tampered client from pointing at another project's column or
-- lane), but deliberately ON DELETE SET NULL instead of stories' NO
-- ACTION: unlike a story actually sitting in a column, a recurring rule
-- is a background config most users won't remember exists, and spec
-- already defines NULL as "leftmost column" / "no lane" fallbacks — so a
-- forgotten rule silently falling back beats blocking deletion of an
-- otherwise-empty column with a misleading "move the stories off this
-- status" error. Column-specific ON DELETE SET NULL (PG15+; this project
-- runs PG17) so only the referencing column, not project_id, is cleared.
alter table public.recurring_stories
  add constraint recurring_stories_status_project_fkey
  foreign key (custom_status_id, project_id)
  references public.custom_statuses (id, project_id)
  on delete set null (custom_status_id);

alter table public.recurring_stories
  add constraint recurring_stories_lane_project_fkey
  foreign key (swimlane_id, project_id)
  references public.swimlanes (id, project_id)
  on delete set null (swimlane_id);

alter table public.recurring_stories enable row level security;

-- Same access pattern as custom_statuses/swimlanes: members read; owner/member write; owner-only delete.
create policy "members can view recurring stories"
  on public.recurring_stories for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create recurring stories"
  on public.recurring_stories for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update recurring stories"
  on public.recurring_stories for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete recurring stories"
  on public.recurring_stories for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- ============================================================
-- generate_recurring_stories: the lazy generation RPC, called on every
-- free-mode board load (see apps/web/app/projects/[id]/board/actions.ts
-- generateRecurringStories). SECURITY DEFINER because it fires for any
-- project member including viewers (system maintenance triggered by a
-- read, same reasoning as finalize_iteration's lazy rollover path) — a
-- viewer could never perform these writes under plain RLS.
--
-- Due dates are computed here in SQL only, never accepted from the
-- caller: this RPC is decision-1's shared deliverable (iOS calls it too),
-- and trusting a client-supplied date would let a tampered client push
-- last_generated_on into the future and permanently stall a rule's
-- generation.
-- ============================================================
create or replace function public.generate_recurring_stories(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  r record;
  v_due date;
  v_month_start date;
  v_month_end date;
  v_status_id uuid;
  v_position int;
  v_claimed_count int;
begin
  if not public.is_project_member(p_project_id) then
    raise exception 'Not a member of this project';
  end if;

  for r in
    select * from public.recurring_stories
    where project_id = p_project_id and is_active
  loop
    -- Most recent occurrence <= today for this rule's cadence.
    if r.cadence = 'daily' then
      v_due := v_today;
    elsif r.cadence = 'weekly' then
      v_due := v_today - (((extract(dow from v_today)::int - r.weekday) + 7) % 7);
    else -- monthly, day_of_month > 28 clamps to month end (spec/data-model.md)
      v_month_start := date_trunc('month', v_today)::date;
      v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;
      v_due := least(v_month_start + (r.day_of_month - 1), v_month_end);
      if v_due > v_today then
        v_month_start := date_trunc('month', v_month_start - interval '1 day')::date;
        v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;
        v_due := least(v_month_start + (r.day_of_month - 1), v_month_end);
      end if;
    end if;

    if r.last_generated_on is not null and r.last_generated_on >= v_due then
      continue;
    end if;

    -- Resolve the effective target column before claiming (AC #7: a card
    -- must not be born completed) — the 20260709000005_free_mode_completed_at.sql
    -- trigger stamps completed_at on insert into an is_done column, so a
    -- rule whose target was toggled is_done after creation must fall back,
    -- not generate a born-completed card. Resolved before the claim so an
    -- unresolvable rule (no non-done column exists) is skipped without
    -- burning the occurrence — it stays due next time a column exists.
    select cs.id into v_status_id
      from public.custom_statuses cs
      where cs.id = r.custom_status_id and cs.project_id = p_project_id and not cs.is_done;

    if v_status_id is null then
      select cs.id into v_status_id
        from public.custom_statuses cs
        where cs.project_id = p_project_id and not cs.is_done
        order by cs.position asc
        limit 1;
    end if;

    if v_status_id is null then
      continue;
    end if;

    update public.recurring_stories
      set last_generated_on = v_due
      where id = r.id
        and (last_generated_on is null or last_generated_on < v_due);
    get diagnostics v_claimed_count = row_count;

    if v_claimed_count > 0 then
      select coalesce(max(position), -1) + 1 into v_position
        from public.stories where project_id = p_project_id;

      insert into public.stories (project_id, title, description, story_type, custom_status_id, swimlane_id, position)
        values (p_project_id, r.title, r.description, 'feature', v_status_id, r.swimlane_id, v_position);
    end if;
  end loop;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.generate_recurring_stories(uuid);
-- drop table public.recurring_stories;
