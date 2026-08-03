-- ============================================================
-- Assignee changes have never produced an activity_logs row. spec/screens.md
-- "Conflict & failure rules" says the trigger "records state/assignment
-- events", which read either as the iteration assignment it already logs or as
-- the story's assignee — and assignee sits in the same section's list of
-- autosaved Discrete fields alongside points, which does produce a row.
--
-- Resolved as the assignee. That sentence is reworded in the same change to
-- name its fields, so spec/screens.md — not this comment — is where the
-- watched list now lives.
--
-- The composite FK from 20260730030000 is the reason this matters beyond
-- symmetry: `on delete set null (assignee_id)` unassigns every story a removed
-- member held, and until now that happened with no trace anywhere. The FK
-- performs a real UPDATE on stories, so the branch below covers the cascade
-- without special-casing it, and auth.uid() there is the member who did the
-- removing.
--
-- move_story_to_project / copy_story_to_project drop a non-member assignee
-- (20260730030000) but do it while INSERTing the story into the target
-- project, not by updating the source row — so they produce story.created,
-- never this action, and need nothing here.
--
-- Ids only, never display names. `profiles` SELECT is
-- `id = auth.uid() or shares_project_with(id)` since 20260709000001, and this
-- function is SECURITY DEFINER — snapshotting a name into the payload would
-- hand a former member's display name to anyone who later joins the project
-- and could not otherwise read that profile. Readers resolve the ids under
-- their own RLS, which is what the actor column has always done
-- (`actor:profiles(display_name)`, falling back to "Someone").
--
-- story.state_changed stores state names directly because states are not
-- RLS-scoped; profiles are. The two are not the same case.
-- ============================================================

-- Verbatim from 20260803000000_mark_containerize_bookkeeping.sql — the CURRENT
-- body, which added the bookkeeping marker — apart from the assignee branch.
-- The stories_log_activity trigger is `after insert or update` with no column
-- list (20260702000001), so it already sees assignee_id writes; only this
-- function changes.
create or replace function public.log_story_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_name text;
  v_old_category text;
  v_new_category text;
  v_old_iteration_number int;
  v_new_iteration_number int;
  v_bookkeeping text := nullif(current_setting('storylane.bookkeeping', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.created', jsonb_build_object('title', new.title)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and new.state_id is distinct from old.state_id then
    if old.state_id is not null then
      select name, category into v_old_name, v_old_category from public.project_states where id = old.state_id;
    end if;
    if new.state_id is not null then
      select name, category into v_new_name, v_new_category from public.project_states where id = new.state_id;
    end if;
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.state_changed',
      jsonb_build_object(
        'from', v_old_name, 'to', v_new_name,
        'from_category', v_old_category, 'to_category', v_new_category,
        'bookkeeping', v_bookkeeping
      )
    );
  end if;

  if tg_op = 'UPDATE' and new.iteration_id is distinct from old.iteration_id then
    if old.iteration_id is not null then
      select number into v_old_iteration_number from public.iterations where id = old.iteration_id;
    end if;
    if new.iteration_id is not null then
      select number into v_new_iteration_number from public.iterations where id = new.iteration_id;
    end if;
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.iteration_changed',
      jsonb_build_object(
        'from_iteration_id', old.iteration_id, 'to_iteration_id', new.iteration_id,
        'from_iteration_number', v_old_iteration_number, 'to_iteration_number', v_new_iteration_number,
        'from_has_state', old.state_id is not null, 'to_has_state', new.state_id is not null,
        'rollover', nullif(current_setting('storylane.rollover', true), ''),
        'bookkeeping', v_bookkeeping
      )
    );
  end if;

  if tg_op = 'UPDATE' and new.points is distinct from old.points then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.points_changed',
      jsonb_build_object('from', old.points, 'to', new.points, 'bookkeeping', v_bookkeeping)
    );
  end if;

  if tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.assignee_changed',
      jsonb_build_object(
        'from_id', old.assignee_id, 'to_id', new.assignee_id,
        -- Carried for uniformity with the three branches above, not because
        -- anything sets it today: no bookkeeping path touches assignee_id. A
        -- branch that could not be marked is the one place a later bookkeeping
        -- UPDATE would escape every reader's filter unnoticed.
        'bookkeeping', v_bookkeeping
      )
    );
  end if;

  return new;
end;
$$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   log_story_activity -> 20260803000000_mark_containerize_bookkeeping.sql
-- Rows already written as story.assignee_changed stay in the table. The
-- project feed renders whatever describeActivity returns and would fall back
-- to its default wording; the story-detail whitelist would stop admitting
-- them. Neither breaks, so the rows are left rather than deleted.
-- ============================================================
