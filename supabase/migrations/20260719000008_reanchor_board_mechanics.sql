-- ============================================================
-- TASK-91 (doc-8 §2): re-anchor backlog/board mechanics from
-- stories.state (dropped in 20260719000006) onto stories.state_id.
-- Word-for-word from the current bodies (20260716000001 for
-- _splice_backlog, 20260716000005 for insert_board_item,
-- 20260718000001 for move_story_board and maintain_story_completed_at)
-- except: the backlog zone predicate is now `state_id is not null`
-- (spec/data-model.md "Backlog zone predicate"), state comparisons use
-- state_id, and dead custom_status_id/swimlane_id reads/writes in
-- move_story_board are removed (those columns are gone). stories.focus
-- is untouched here — its removal is TASK-88/89, not this task.
-- ============================================================

create or replace function public._splice_backlog(
  p_project_id uuid,
  p_kind text,
  p_id uuid,
  p_before_kind text,
  p_before_id uuid
)
returns void
language plpgsql
as $$
declare
  v_ordered_kinds text[] := '{}';
  v_ordered_story_ids uuid[] := '{}';
  v_ordered_div_ids uuid[] := '{}';
  v_inserted boolean := false;
  v_rk text;
  v_ri uuid;
begin
  for v_rk, v_ri in
    select kind, id from (
      select 'story'::text as kind, id, position from public.stories
        where project_id = p_project_id and iteration_id is null and state_id is not null
      union all
      select 'divider'::text as kind, id, position from public.backlog_dividers
        where project_id = p_project_id
    ) merged
    where not (kind = p_kind and id = p_id)
    order by position
  loop
    if not v_inserted and p_before_id is not null
       and v_rk = p_before_kind and v_ri = p_before_id then
      v_ordered_kinds := v_ordered_kinds || p_kind;
      if p_kind = 'story' then v_ordered_story_ids := v_ordered_story_ids || p_id;
        else v_ordered_div_ids := v_ordered_div_ids || p_id; end if;
      v_inserted := true;
    end if;
    v_ordered_kinds := v_ordered_kinds || v_rk;
    if v_rk = 'story' then v_ordered_story_ids := v_ordered_story_ids || v_ri;
      else v_ordered_div_ids := v_ordered_div_ids || v_ri; end if;
  end loop;
  if not v_inserted then
    v_ordered_kinds := v_ordered_kinds || p_kind;
    if p_kind = 'story' then v_ordered_story_ids := v_ordered_story_ids || p_id;
      else v_ordered_div_ids := v_ordered_div_ids || p_id; end if;
  end if;

  perform public._resequence_backlog(v_ordered_kinds, v_ordered_story_ids, v_ordered_div_ids);
end;
$$;

-- Inserts a new backlog story landing in the project's first (min-position)
-- unstarted-category state — the Backlog's own entry point (Icebox stories
-- are created directly with state_id NULL by the Web/MCP client, this path
-- is specifically "unstarted" per its original 'unstarted' literal).
create or replace function public.insert_board_item(
  p_project_id uuid,
  p_kind text,
  p_payload jsonb,
  p_anchor jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new_id uuid;
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
  v_title text;
  v_label text;
  v_divider_kind text;
  v_unstarted_state_id uuid;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  if p_kind = 'story' then
    v_title := btrim(coalesce(p_payload->>'title', ''));
    if v_title = '' then
      raise exception 'title required' using errcode = 'P0001';
    end if;

    select id into v_unstarted_state_id
      from public.project_states
      where project_id = p_project_id and category = 'unstarted'
      order by position, id
      limit 1;
    if v_unstarted_state_id is null then
      raise exception 'project has no unstarted-category state' using errcode = 'P0001';
    end if;

    insert into public.stories (project_id, title, story_type, state_id, iteration_id)
      values (p_project_id, v_title, 'feature', v_unstarted_state_id, null)
      returning id into v_new_id;
  elsif p_kind = 'divider' then
    v_divider_kind := coalesce(p_payload->>'kind', 'note');
    if v_divider_kind not in ('note', 'iteration_break') then
      raise exception 'invalid divider kind' using errcode = 'P0001';
    end if;
    v_label := btrim(coalesce(p_payload->>'label', ''));
    if v_divider_kind = 'note' and v_label = '' then
      raise exception 'label required for note' using errcode = 'P0001';
    end if;
    insert into public.backlog_dividers (project_id, label, kind)
      values (p_project_id, v_label, v_divider_kind)
      returning id into v_new_id;
  else
    raise exception 'invalid item kind' using errcode = 'P0001';
  end if;

  perform public._splice_backlog(p_project_id, p_kind, v_new_id, v_before_kind, v_before_id);

  return v_new_id;
end;
$$;

create or replace function public.move_story_board(
  p_project_id uuid,
  p_item jsonb,
  p_view text,
  p_expected jsonb,
  p_deltas jsonb,
  p_anchor jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_kind text := p_item->>'kind';
  v_id uuid := (p_item->>'id')::uuid;
  v_story record;
  v_current_id uuid;
  v_new_state_id uuid;
  v_state_set boolean;
  v_new_iteration uuid;
  v_new_focus text;
  v_zone text;
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
  v_story_ids uuid[];
  v_inserted boolean := false;
  v_pos int;
  i int;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  select id into v_current_id
    from public.iterations
    where project_id = p_project_id and state <> 'done'
    order by number desc
    limit 1;

  if v_kind = 'story' then
    select state_id, iteration_id, focus
      into v_story
      from public.stories
      where id = v_id and project_id = p_project_id
      for update;
    if not found then
      raise exception 'story not found' using errcode = 'P0002';
    end if;

    if v_story.state_id is distinct from (p_expected->>'state_id')::uuid
       or v_story.iteration_id is distinct from (p_expected->>'iteration_id')::uuid
       or v_story.focus is distinct from (p_expected->>'focus') then
      raise exception 'stale story state; refresh and retry' using errcode = 'P0001';
    end if;

    v_state_set := p_deltas ? 'state_id';
    v_new_state_id := case when v_state_set then (p_deltas->>'state_id')::uuid else v_story.state_id end;
    if p_deltas ? 'iteration' then
      if p_deltas->>'iteration' = 'current' then
        if v_current_id is null then
          raise exception 'no active iteration' using errcode = 'P0001';
        end if;
        v_new_iteration := v_current_id;
      else
        v_new_iteration := null;
      end if;
    else
      v_new_iteration := v_story.iteration_id;
    end if;
    v_new_focus := case when p_deltas ? 'focus'
      then p_deltas->>'focus' else v_story.focus end;

    update public.stories
      set state_id = v_new_state_id,
          iteration_id = v_new_iteration,
          focus = v_new_focus
      where id = v_id;
  else
    if not exists (
      select 1 from public.backlog_dividers where id = v_id and project_id = p_project_id
    ) then
      raise exception 'divider not found' using errcode = 'P0002';
    end if;
    v_new_state_id := null;
  end if;

  if v_kind = 'divider' then
    v_zone := 'backlog';
  elsif p_view = 'list' and v_new_state_id is not null
        and (v_current_id is null or v_new_iteration is distinct from v_current_id) then
    v_zone := 'backlog';
  else
    v_zone := 'single';
  end if;

  if v_zone = 'single' then
    if p_view = 'tracker' then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
          and state_id is not distinct from v_new_state_id;
    elsif p_view = 'focus' then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
          and focus is not distinct from v_new_focus;
    else
      if v_new_state_id is null then
        select coalesce(array_agg(id order by position), '{}') into v_story_ids
          from public.stories
          where project_id = p_project_id and id <> v_id and state_id is null;
      else
        select coalesce(array_agg(id order by position), '{}') into v_story_ids
          from public.stories
          where project_id = p_project_id and id <> v_id and iteration_id = v_current_id;
      end if;
    end if;

    v_pos := 0;
    for i in 1 .. coalesce(array_length(v_story_ids, 1), 0) loop
      if not v_inserted and v_before_id is not null and v_story_ids[i] = v_before_id then
        update public.stories set position = v_pos where id = v_id;
        v_pos := v_pos + 1;
        v_inserted := true;
      end if;
      update public.stories set position = v_pos where id = v_story_ids[i];
      v_pos := v_pos + 1;
    end loop;
    if not v_inserted then
      update public.stories set position = v_pos where id = v_id;
    end if;
    return;
  end if;

  perform public._splice_backlog(p_project_id, v_kind, v_id, v_before_kind, v_before_id);
end;
$$;

-- completed_at: set when entering a done-category state, cleared when
-- leaving, preserved on a done-to-done move (a state_id change between two
-- different done-category states, e.g. re-labelling which "done" column a
-- story sits in, must not reset the original acceptance timestamp).
create or replace function public.maintain_story_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_category text;
  v_new_category text;
begin
  if tg_op = 'UPDATE' and new.state_id is not distinct from old.state_id then
    new.completed_at := old.completed_at;
    return new;
  end if;

  if new.state_id is not null then
    select category into v_new_category from public.project_states where id = new.state_id;
  end if;

  if tg_op = 'UPDATE' and old.state_id is not null then
    select category into v_old_category from public.project_states where id = old.state_id;
  end if;

  if v_new_category = 'done' then
    if v_old_category = 'done' then
      new.completed_at := old.completed_at; -- done-to-done: preserve
    else
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore _splice_backlog / insert_board_item / move_story_board /
--  maintain_story_completed_at from their pre-TASK-91 bodies: 20260716000001,
--  20260716000005, 20260718000001, 20260718000001 respectively — all
--  reference the dropped stories.state column and cannot run as-is)
