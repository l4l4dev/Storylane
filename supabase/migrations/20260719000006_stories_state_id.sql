-- ============================================================
-- TASK-91 (doc-8 §2): stories.state (fixed 7-value enum) -> stories.state_id
-- (composite FK to project_states, NULL = Icebox). Also drops
-- stories.custom_status_id / swimlane_id (dead columns left over from
-- TASK-84's free-mode removal, explicitly deferred to this task by that
-- migration's own comment).
--
-- No data migration for existing rows (pre-launch, consistent with every
-- other doc-8 removal this cycle): every existing story's state_id is set
-- to NULL (lands in the Icebox) rather than attempting to map its old
-- literal state onto a newly-created project_states row. Existing projects
-- get a classic-template project_states set backfilled below so their
-- board isn't empty and the >=1 unstarted / >=1 done invariant holds from
-- the moment this migration completes.
--
-- projects.state_template records which template a NEW project seeds at
-- creation (classic | minimal, doc-8 §2) — read once by the AFTER INSERT
-- trigger below, not meant to change the template after creation (that's
-- what per-state editing in Settings is for).
-- ============================================================

alter table public.projects
  add column state_template text not null default 'classic'
    check (state_template in ('classic', 'minimal'));

alter table public.stories
  add column state_id uuid,
  add constraint stories_state_project_fkey
    foreign key (state_id, project_id) references public.project_states(id, project_id);

-- Seeds a project's project_states rows from its state_template. Shared by
-- the new-project trigger below and the one-time backfill further down, so
-- the two seeding paths can never drift apart.
create or replace function public.seed_project_states(p_project_id uuid, p_template text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_template = 'minimal' then
    insert into public.project_states (project_id, name, action_label, category, position) values
      (p_project_id, 'Todo',  'Start', 'unstarted',   0),
      (p_project_id, 'Doing', 'Done',  'in_progress', 1),
      (p_project_id, 'Done',  null,    'done',        2);
  else
    -- classic: the Pivotal-parity anchor. Delivered's action_label ("Accept")
    -- is the accept-half of the Accept/Reject pair the UI renders on the
    -- state immediately before a done-category state; "Reject" and
    -- "Restart" are fixed UI vocabulary, not stored (see this table's
    -- own migration comment, 20260719000005).
    insert into public.project_states (project_id, name, action_label, category, position) values
      (p_project_id, 'Unstarted', 'Start',  'unstarted',   0),
      (p_project_id, 'Started',   'Finish', 'in_progress', 1),
      (p_project_id, 'Finished',  'Deliver','in_progress', 2),
      (p_project_id, 'Delivered', 'Accept', 'in_progress', 3),
      (p_project_id, 'Accepted',  null,     'done',        4),
      (p_project_id, 'Rejected',  null,     'rejected',    5);
  end if;
end;
$$;

create or replace function public.handle_new_project_states()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_project_states(new.id, new.state_template);
  return new;
end;
$$;

revoke execute on function public.seed_project_states(uuid, text) from public, authenticated;
revoke execute on function public.handle_new_project_states() from public, authenticated;

create trigger on_project_created_seed_states
  after insert on public.projects
  for each row execute function public.handle_new_project_states();

-- One-time backfill for projects that already existed before this
-- migration (they have zero project_states rows and every story's new
-- state_id column defaults to NULL already via the ADD COLUMN above).
do $$
declare
  v_project record;
begin
  for v_project in select id from public.projects loop
    if not exists (select 1 from public.project_states where project_id = v_project.id) then
      perform public.seed_project_states(v_project.id, 'classic');
    end if;
  end loop;
end;
$$;

-- Now safe to drop the old enum column and its CHECK, and the dead
-- free-mode columns.
alter table public.stories drop constraint stories_state_check;
alter table public.stories drop column state;
alter table public.stories drop column custom_status_id;
alter table public.stories drop column swimlane_id;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.stories add column state text not null default 'unscheduled'
--   check (state in ('unscheduled', 'unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected'));
-- alter table public.stories add column custom_status_id uuid;
-- alter table public.stories add column swimlane_id uuid;
-- drop trigger on_project_created_seed_states on public.projects;
-- drop function public.handle_new_project_states();
-- drop function public.seed_project_states(uuid, text);
-- alter table public.stories drop constraint stories_state_project_fkey;
-- alter table public.stories drop column state_id;
-- alter table public.projects drop column state_template;
