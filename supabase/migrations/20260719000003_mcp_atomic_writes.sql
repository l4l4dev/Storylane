-- ============================================================
-- TASK-71: atomic multi-write RPCs for the MCP server.
-- Advisor-approved (Fable, 2026-07-18): PostgREST has no client-side
-- transaction, so the MCP handlers' DELETE-then-INSERT "replace" flows and the
-- create-then-label flow were split across separate requests — a failure
-- between them left a wiped checklist, a half-replaced label set, or an
-- orphaned story an agent retry would duplicate. Each flow becomes one RPC so
-- the whole thing commits or rolls back together.
--
-- All three are SECURITY INVOKER: the writes run as the caller, gated by the
-- existing member-role RLS on stories/tasks/story_labels (any project member
-- may insert/update/delete). No service-role escalation. Grants follow the
-- lockdown convention (revoke from public+authenticated, grant to authenticated).
-- ============================================================

-- Replace a story's checklist atomically. position is left to the column
-- DEFAULT nextval(tasks_position_seq) — never written explicitly (the position
-- invariant in spec/data-model.md; the old handler's `position: i` bypassed the
-- sequence and could collide with a later plain INSERT on the deferred
-- UNIQUE (story_id, position)). WITH ORDINALITY + ORDER BY fixes the row
-- production order, so the sequence values ascend in the caller's array order.
create function public.set_story_tasks(p_story_id uuid, p_tasks jsonb)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Explicit permission/existence gate so an empty payload against a story the
  -- caller can't write is a clear error, not a 0-row "success" (the ambiguity
  -- transition_story, 20260717000004, was fixed to avoid). A non-empty payload
  -- is already blocked by the tasks WITH CHECK, but the empty case would slip
  -- through both the DELETE and INSERT as 0 rows.
  perform 1 from public.stories
    where stories.id = p_story_id and public.project_role(stories.project_id) in ('owner', 'member');
  if not found then
    raise exception 'Not allowed to edit tasks (not a member of this story''s project, or it does not exist)'
      using errcode = '42501';
  end if;

  delete from public.tasks where story_id = p_story_id;

  insert into public.tasks (story_id, title, is_done)
  select p_story_id, e.elem ->> 'title', coalesce((e.elem ->> 'is_done')::boolean, false)
  from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) with ordinality as e(elem, ord)
  order by e.ord;

  return query
    select * from public.tasks where story_id = p_story_id order by position;
end;
$$;

-- Replace a story's label set atomically. Label name->id resolution (and
-- create-if-missing) stays in the client: a label left unused by a failed
-- replace is a valid, reusable project label, not corruption. distinct guards
-- against a duplicate id in the input causing a PK violation.
create function public.set_story_labels(p_story_id uuid, p_label_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Same explicit gate as set_story_tasks: an empty label set against an
  -- unwritable story must error, not silently no-op (transition_story pattern).
  perform 1 from public.stories
    where stories.id = p_story_id and public.project_role(stories.project_id) in ('owner', 'member');
  if not found then
    raise exception 'Not allowed to edit labels (not a member of this story''s project, or it does not exist)'
      using errcode = '42501';
  end if;

  delete from public.story_labels where story_id = p_story_id;
  insert into public.story_labels (story_id, label_id)
  select p_story_id, x
  from (select distinct unnest(p_label_ids) as x) d
  where x is not null;
end;
$$;

-- Create a tracker-mode story and attach its labels in one transaction, so a
-- label failure rolls the story back too (otherwise the story persists and an
-- agent retry creates a duplicate). number is trigger-assigned, position is the
-- sequence DEFAULT. Destination->state/iteration resolution and label name->id
-- resolution stay in the handler. state/story_type are coalesced to the table
-- defaults because an explicit NULL would violate their NOT NULL columns.
create function public.create_story_tracker(
  p_project_id uuid,
  p_title text,
  p_state text,
  p_iteration_id uuid,
  p_description text,
  p_story_type text,
  p_points int,
  p_epic_id uuid,
  p_label_ids uuid[]
)
returns table (id uuid, number int, title text, state text, iteration_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.stories (project_id, title, state, iteration_id, description, story_type, points, epic_id)
  values (
    p_project_id,
    p_title,
    coalesce(p_state, 'unstarted'),
    p_iteration_id,
    p_description,
    coalesce(p_story_type, 'feature'),
    p_points,
    p_epic_id
  )
  returning stories.id into v_id;

  if p_label_ids is not null and array_length(p_label_ids, 1) is not null then
    insert into public.story_labels (story_id, label_id)
    select v_id, x
    from (select distinct unnest(p_label_ids) as x) d
    where x is not null;
  end if;

  return query
    select s.id, s.number, s.title, s.state, s.iteration_id
    from public.stories s
    where s.id = v_id;
end;
$$;

revoke execute on function public.set_story_tasks(uuid, jsonb) from public, authenticated;
grant execute on function public.set_story_tasks(uuid, jsonb) to authenticated;
revoke execute on function public.set_story_labels(uuid, uuid[]) from public, authenticated;
grant execute on function public.set_story_labels(uuid, uuid[]) to authenticated;
revoke execute on function public.create_story_tracker(uuid, text, text, uuid, text, text, int, uuid, uuid[]) from public, authenticated;
grant execute on function public.create_story_tracker(uuid, text, text, uuid, text, text, int, uuid, uuid[]) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.create_story_tracker(uuid, text, text, uuid, text, text, int, uuid, uuid[]);
-- drop function public.set_story_labels(uuid, uuid[]);
-- drop function public.set_story_tasks(uuid, jsonb);
