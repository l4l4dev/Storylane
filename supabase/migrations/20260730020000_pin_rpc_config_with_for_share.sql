-- ============================================================
-- TASK-219: a precondition enforced only inside an RPC is PINNED with
-- `select ... for share`, not re-read at the exit.
--
-- The per-value exit re-reads this replaces were unsound, not merely
-- unenumerable. An unlocked read races the COMMIT itself: `update projects set
-- point_scale = ...` can commit between an exit guard's read and this
-- transaction's own commit, so the guard narrowed the window instead of closing
-- it. 20260728100000 is the counter-example for the other candidate design
-- (re-derive the inputs after the last wait): it already reads the webhook
-- configuration after BOTH of finish_story_from_git's waits, and the forward-only
-- comparison below it was still decided on unlocked project_states rows.
--
-- A `for share` holds until commit, so one read is authoritative and a concurrent
-- settings write waits. It needs no cooperation from the writer, which is what
-- makes it the only mechanism that fits here: projects, project_states and
-- integrations each have a direct UPDATE policy for `authenticated`, and
-- app/projects/[id]/settings/actions.ts and app/dashboard/actions.ts PATCH them
-- without going through any RPC, so no advisory-lock convention can cover them.
--
-- Lock order, extending 20260730000000's invariant to three tiers:
--   advisory locks -> config-row `for share` -> story row locks
-- Every config writer already agrees: change_member_role, remove_member,
-- create_project_state and reorder_project_state take their advisory lock before
-- writing, and a settings PATCH holds one row lock and waits for nothing.
--
-- project_states is pinned per project as a whole set, not row by row, because
-- one of the two rows finish_story_from_git compares is only known after the
-- story read. A state row pinned BELOW the story row lock deadlocks against a
-- routine Settings action: `delete from project_states` holds the state row and
-- then waits FOR KEY SHARE on the stories referencing it, because
-- stories_state_project_fkey is NO ACTION and its check locks them. The set is
-- known from project_id alone, so pinning all of it stays in tier. That is also
-- why finish_story_from_git takes project_states_positions:, the key
-- reorder_project_state and create_project_state hold while they each write two
-- rows.
--
-- One row is still pinned out of tier: the retained assignee's membership row in
-- move/copy, whose identity is only known after the story read. It closes no
-- cycle — nothing references project_members, so no writer reaches one through a
-- story row lock (remove_member reads stories and locks none). TASK-221's
-- composite FK would give remove_member exactly that story row lock, so it has
-- to revisit this.
--
-- Two things deliberately NOT converted, both recorded in spec/rls.md:
--   * The role. project_members has no UPDATE or DELETE policy, so every change
--     goes through change_member_role/remove_member; the re-check pattern stays
--     as TASK-211 shipped it.
--   * update_story. It is SECURITY INVOKER, and under RLS a locking clause also
--     requires the row to pass the UPDATE policy's USING — a non-owner member
--     locking its own project's row gets zero rows (measured), which would read
--     as "no scale". It takes only the literal helper here, and TASK-208 already
--     makes the off-scale value it can store deliberate.
-- ============================================================

-- ── point_scale_values ───────────────────────────────────────────────────────
-- The DB's single copy of the scale literals (packages/core/src/story-types.ts is
-- the client's). Takes the columns rather than a project id so it stays IMMUTABLE
-- and each caller keeps its own `for share`: a helper that read the row itself
-- would have to be SECURITY DEFINER to serve update_story's INVOKER caller, and
-- would then hand a project's scale to non-members.
--
-- A custom scale may contain NULL (projects.custom_points has no constraint
-- against one), so the returned array may too. Compare with a positive
-- `= any(...)`: a negated test yields NULL for an off-scale value and `if` reads
-- NULL as false, which silently accepts it.
create or replace function public.point_scale_values(p_scale text, p_custom int[])
returns int[]
language sql
immutable
set search_path = public
as $$
  select case p_scale
    when 'fibonacci' then array[0, 1, 2, 3, 5, 8, 13]
    when 'linear' then array[0, 1, 2, 3]
    when 'custom' then coalesce(p_custom, array[]::int[])
    else array[0, 1, 2, 3, 5, 8, 13]
  end;
$$;

revoke all on function public.point_scale_values(text, int[]) from public;
grant execute on function public.point_scale_values(text, int[]) to authenticated, service_role;

-- ── update_story ─────────────────────────────────────────────────────────────
-- Verbatim replacement of 20260728061500's body except the scale literals.
create or replace function public.update_story(
  p_story_id uuid,
  p_title text,
  p_description text,
  p_story_type text,
  p_points int,
  p_parent_id uuid,
  p_assignee_id uuid,
  p_label_ids uuid[] default array[]::uuid[]
)
 RETURNS TABLE(id uuid, project_id uuid, number integer, title text, description text, story_type text, state_id uuid, points integer, parent_id uuid, assignee_id uuid, label_ids uuid[])
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_point_scale text;
  v_custom_points int[];
  v_allowed_points int[];
  v_points int;
  v_current_points int;
  v_title text := trim(p_title);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_title = '' then
    raise exception 'Title cannot be empty';
  end if;

  -- Locks the row (within RLS's SELECT visibility) so a concurrent autosave
  -- serializes against this one instead of both reading stale project data.
  select s.project_id, s.points into v_project_id, v_current_points
  from public.stories s
  where s.id = p_story_id
  for update;

  if not found then
    -- Deleted or not visible under RLS — caller treats zero rows as "not found".
    return;
  end if;

  select pr.point_scale, pr.custom_points into v_point_scale, v_custom_points
  from public.projects pr
  where pr.id = v_project_id;

  -- Mirrors lib/utils/stories.ts "parsePoints" — a non-pointed type or an
  -- out-of-scale value parses to null rather than rejecting the save.
  v_allowed_points := public.point_scale_values(v_point_scale, v_custom_points);

  if p_story_type not in ('feature', 'bug') then
    v_points := null;
  elsif p_points = any(v_allowed_points) then
    v_points := p_points;
  elsif p_points is not distinct from v_current_points then
    -- Off-scale but unchanged: the caller echoed back what is already stored,
    -- which every autosave does once point_scale has been narrowed. Nulling it
    -- here would clear an estimate the user never touched.
    v_points := v_current_points;
  else
    v_points := null;
  end if;

  -- RLS still applies to this UPDATE even though the row was already locked —
  -- a caller who can see but not write updates zero rows. Never touches
  -- project_id or state_id (owned by move/copy and set_story_state). parent_id
  -- is the doc-18 nesting link; the single-level + is_container triggers
  -- (TASK-179) validate/react to the change.
  update public.stories s
  set title = v_title,
      description = v_description,
      story_type = p_story_type,
      points = v_points,
      parent_id = p_parent_id,
      assignee_id = p_assignee_id
  where s.id = p_story_id;

  delete from public.story_labels where story_id = p_story_id;
  if coalesce(array_length(p_label_ids, 1), 0) > 0 then
    insert into public.story_labels (story_id, label_id)
    select p_story_id, label_id from unnest(p_label_ids) as label_id;
  end if;

  return query
  select
    s.id, s.project_id, s.number, s.title, s.description, s.story_type, s.state_id,
    s.points, s.parent_id, s.assignee_id,
    coalesce(array_agg(sl.label_id) filter (where sl.label_id is not null), array[]::uuid[])
  from public.stories s
  left join public.story_labels sl on sl.story_id = s.id
  where s.id = p_story_id
  group by s.id;
end;
$function$;

-- ── split_story ──────────────────────────────────────────────────────────────
create or replace function public.split_story(p_story_id uuid, p_children jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  -- Stands in for v_source.project_id everywhere below. No trigger pins
  -- stories.project_id and the UPDATE policy only checks project_role of the
  -- row's own project, so what actually holds the column still is
  -- activity_logs_story_project_fk (20260715000006), a composite FK on
  -- (story_id, project_id) that every logged story has a row for. The locked read
  -- re-pins it anyway rather than depending on a constraint two tables away.
  v_project_id      uuid;
  v_role            text;
  v_source          public.stories%rowtype;
  v_src_category    text;
  v_first_unstarted uuid;
  v_child_state     uuid;
  v_child_iter      uuid;
  v_iter_done       boolean;
  v_allowed_points  int[];
  v_child_points    int;
  v_child           jsonb;
  v_new_id          uuid;
  v_child_ids       uuid[] := '{}';
  v_task_ids        uuid[];
  v_all_task_ids    uuid[];
begin
  -- Unlocked, and only to build the advisory-lock keys below. `is null` rather
  -- than `perform ... if not found` because `perform` sets FOUND and nothing
  -- could then be placed between the probe and the branch reading it.
  select project_id into v_project_id from public.stories where id = p_story_id;
  if v_project_id is null then
    raise exception 'Story not found';
  end if;

  -- Authorize, then serialize. Without this a non-member would queue on, and
  -- briefly hold, a project-wide lock on a call certain to be refused, and the
  -- DEFINER probe above would have already told them the story exists. The
  -- FOR UPDATE below stays authoritative; this only raises the same message
  -- earlier. `is null` first because project_role returns NULL for a non-member
  -- and `NULL not in (...)` is NULL, which `if` reads as false.
  v_role := public.project_role(v_project_id);
  if v_role is null or not (v_role = any(v_roles)) then
    raise exception 'Story not found';
  end if;

  -- Child inserts take the number lock; positions is held even though children
  -- are only appended (no compaction), so a concurrent splice cannot interleave.
  perform pg_advisory_xact_lock(hashtext('positions:' || v_project_id::text));
  perform pg_advisory_xact_lock(hashtext('story_number:' || v_project_id::text));

  -- Pinned above the story row lock (three-tier order, see the header) and read
  -- once: the clamp below is the only enforcement of "child points are on the
  -- project's scale", so the row has to stay put until commit.
  select public.point_scale_values(point_scale, custom_points) into v_allowed_points
    from public.projects where id = v_project_id
    for share;

  -- owner/member on the source project; also the write lock. The membership
  -- subquery deliberately stays as it is: collapsing "not yours" into "Story not
  -- found" is what keeps this from confirming a story exists in a project the
  -- caller cannot see.
  select * into v_source from public.stories
    where id = p_story_id
      and project_id = v_project_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role = any(v_roles)
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- The read above can still wait on a concurrent row lock, so the caller's role
  -- is re-checked after it. Re-checking by project_id is safe now that the row
  -- read has already established the caller could see it.
  perform public.require_project_role(v_project_id, variadic v_roles);

  -- An existing container has no board state to hand down (children would all
  -- fall to the Icebox); a child cannot gain children (single-level, §3).
  if v_source.is_container then
    raise exception 'This story is already a container and cannot be split' using errcode = 'P0001';
  end if;
  if v_source.parent_id is not null then
    raise exception 'A child story cannot be split (single-level nesting, doc-18 §3)' using errcode = 'P0001';
  end if;
  if p_children is null or jsonb_array_length(p_children) = 0 then
    raise exception 'Split requires at least one child story' using errcode = 'P0001';
  end if;

  -- A task assigned to two children would silently drop the second request —
  -- reject up front rather than partially applying it.
  select array_agg(t) into v_all_task_ids
    from jsonb_array_elements(p_children) as c,
         jsonb_array_elements_text(coalesce(c->'task_ids', '[]'::jsonb)) as t;
  if v_all_task_ids is not null
     and array_length(v_all_task_ids, 1) <> (select count(distinct t) from unnest(v_all_task_ids) as t) then
    raise exception 'A task cannot be assigned to more than one new story' using errcode = 'P0001';
  end if;

  -- Child landing (doc-18 §7) — captured BEFORE the first child insert, which
  -- fires the §4 trigger that NULLs the source's state_id/iteration_id.
  if v_source.state_id is null then
    v_child_state := null; -- Icebox stays Icebox
  else
    select category into v_src_category from public.project_states where id = v_source.state_id;
    if v_src_category = 'unstarted' then
      v_child_state := v_source.state_id; -- a valid fresh start; carry it over
    else
      select id into v_first_unstarted from public.project_states
        where project_id = v_project_id and category = 'unstarted'
        order by position, id limit 1;
      v_child_state := v_first_unstarted; -- in_progress/done/rejected is no start
    end if;
  end if;

  if v_child_state is null or v_source.iteration_id is null then
    v_child_iter := null; -- Icebox children never carry an iteration
  else
    select state = 'done' into v_iter_done from public.iterations where id = v_source.iteration_id;
    v_child_iter := case when coalesce(v_iter_done, false) then null else v_source.iteration_id end;
  end if;

  for v_child in select value from jsonb_array_elements(p_children)
  loop
    -- Clamp an off-scale (or non-numeric) tentative points value to NULL
    -- (parity with update_story / move / copy). The Split Studio offers a
    -- scale-constrained picker, but the RPC is a trust boundary: a non-number
    -- in the JSON must not abort the whole split with a raw cast error.
    v_child_points := case
      when jsonb_typeof(v_child->'points') = 'number' then (v_child->>'points')::int
      else null
    end;
    if v_child_points is not null then
      v_child_points := (select v_child_points where v_child_points = any(v_allowed_points));
    end if;

    -- position omitted: default nextval appends at the sequence frontier
    -- (position invariant rule 1). assignee never inherited (§7).
    insert into public.stories (
      project_id, parent_id, title, description, story_type, points,
      state_id, iteration_id, epic_color, assignee_id, created_by
    ) values (
      v_project_id, p_story_id,
      v_child->>'title', v_child->>'description',
      coalesce(v_child->>'story_type', 'feature'), v_child_points,
      v_child_state, v_child_iter, v_source.epic_color, null, auth.uid()
    )
    returning id into v_new_id;
    v_child_ids := v_child_ids || v_new_id;

    -- Reassign the dragged tasks — only the source's own tasks; the rest stay
    -- on the source (now the container).
    if v_child ? 'task_ids' and jsonb_array_length(v_child->'task_ids') > 0 then
      select array_agg(value::uuid) into v_task_ids from jsonb_array_elements_text(v_child->'task_ids');
      update public.tasks set story_id = v_new_id
        where story_id = p_story_id and id = any(v_task_ids);
    end if;
  end loop;

  -- Audit the split on the source (comments/activity stay on it, §7). The §4
  -- trigger separately logs story.containerized (old points); each child insert
  -- logs story.created.
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_project_id, p_story_id, auth.uid(), 'story.split',
    jsonb_build_object('child_ids', to_jsonb(v_child_ids), 'child_count', array_length(v_child_ids, 1))
  );

  -- Exit guard for the ROLE only. Enumerating this function's waits does not
  -- terminate — an UPDATE waits on a tuple lock, an INSERT on a foreign-key row,
  -- a trigger on whatever it calls — so the guard goes after every write rather
  -- than after each wait. Nothing above is durable until commit, so raising here
  -- rolls all of it back. The point scale needs no counterpart: it is pinned.
  perform public.require_project_role(v_project_id, variadic v_roles);

  return jsonb_build_object('parent_id', p_story_id, 'child_ids', to_jsonb(v_child_ids));
end;
$$;

-- ── move_story_to_project ────────────────────────────────────────────────────
create or replace function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  -- Only to reach the checks that guard the lock before the locked read runs; the
  -- read re-pins it, so nothing downstream trusts this copy.
  v_source_project  uuid;
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_allowed_points  int[];
  v_target_archived timestamptz;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
  select project_id into v_source_project from public.stories where id = p_story_id;
  if v_source_project is null then
    raise exception 'Story not found';
  end if;

  -- Source before target, because the checks below now run ahead of the read that
  -- used to reject first: without this a viewer of the source would be told about
  -- its target membership instead of getting the read's generic 'Story not found',
  -- which is what keeps viewer-of-source indistinguishable from non-member.
  if not (coalesce(public.project_role(v_source_project), '') = any(v_roles)) then
    raise exception 'Story not found';
  end if;

  if not (coalesce(public.project_role(p_target_project_id), '') = any(v_roles)) then
    raise exception 'Not a member of the target project';
  end if;
  if v_source_project = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  -- Both project rows pinned here, source first, and read once each. archived_at
  -- and the point scale are enforced nowhere but in this function, so a settings
  -- PATCH landing during any wait below would otherwise decide against a value
  -- this transaction has already used. Source-then-target is a fixed order so two
  -- opposite moves between the same pair cannot build a cycle out of them.
  select archived_at into v_source_archived
    from public.projects where id = v_source_project
    for share;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  select archived_at, public.point_scale_values(point_scale, custom_points)
    into v_target_archived, v_allowed_points
    from public.projects where id = p_target_project_id
    for share;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  select * into v_story from public.stories
    where id = p_story_id
      and project_id = v_source_project
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role = any(v_roles)
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- A container's row is only a grouping parent; deleting the source (Move =
  -- insert-into-target + delete-source) would SET NULL its children's parent_id
  -- and silently explode the epic (doc-18 §8). Move the children instead.
  if v_story.is_container then
    raise exception 'A container cannot be moved — move or regroup its children instead' using errcode = 'P0001';
  end if;

  -- story_number is contended by every numbering path in the target project,
  -- so this wait is unbounded in practice. Re-assert BOTH sides: the caller
  -- can lose write access to either project while parked here. The source
  -- membership subquery in the read above stays as it is, for the same
  -- story-existence reason as split_story.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  if v_story.points is null then
    v_points := null;
  else
    v_points := (select v_story.points where v_story.points = any(v_allowed_points));
  end if;

  -- Pinned out of tier order: which membership row matters is only known from the
  -- locked story read. spec/features.md keeps the assignee only if they are a
  -- member of the target, and the INSERT below can wait, so the row has to be
  -- held rather than merely tested. A row that does not exist locks nothing,
  -- which is the same answer as before: drop the assignee.
  if v_story.assignee_id is null then
    v_assignee := null;
  else
    perform 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
      for share;
    v_assignee := case when found then v_story.assignee_id else null end;
  end if;

  -- Child move drops parent_id: the fresh target insert never carries the
  -- source project's parent_id (doc-18 §8).
  insert into public.stories (
    project_id, title, description, story_type, points,
    assignee_id, created_by
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    v_points, v_assignee, auth.uid()
  )
  returning id, number into v_new_id, v_new_number;

  update public.tasks set story_id = v_new_id where story_id = p_story_id;
  update public.comments set story_id = v_new_id where story_id = p_story_id;

  for v_label in
    select l.name, l.color from public.story_labels sl
    join public.labels l on l.id = sl.label_id
    where sl.story_id = p_story_id
  loop
    select id into v_target_label from public.labels
      where project_id = p_target_project_id and name = v_label.name
      order by id limit 1;

    if v_target_label is null then
      insert into public.labels (project_id, name, color)
      values (p_target_project_id, v_label.name, v_label.color)
      returning id into v_target_label;
    end if;

    insert into public.story_labels (story_id, label_id)
    values (v_new_id, v_target_label)
    on conflict (story_id, label_id) do nothing;
  end loop;

  delete from public.stories where id = p_story_id;

  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_story.project_id, null, auth.uid(), 'story.moved_out',
    jsonb_build_object('target_project_id', p_target_project_id, 'title', v_story.title)
  );
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    p_target_project_id, v_new_id, auth.uid(), 'story.moved_in',
    jsonb_build_object('source_project_id', v_story.project_id, 'title', v_story.title)
  );

  -- Exit guard for the ROLE only. Enumerating this function's waits does not
  -- terminate — an UPDATE waits on a tuple lock, an INSERT on a foreign-key row,
  -- a trigger on whatever it calls — so the guard goes after every write rather
  -- than after each wait. Nothing above is durable until commit, so raising here
  -- rolls all of it back. archived_at, the point scale and the assignee's
  -- membership need no counterpart here: all three rows are pinned.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

-- ── copy_story_to_project ────────────────────────────────────────────────────
create or replace function public.copy_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_source_project  uuid;
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_allowed_points  int[];
  v_target_archived timestamptz;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
  select project_id into v_source_project from public.stories where id = p_story_id;
  if v_source_project is null then
    raise exception 'Story not found';
  end if;

  -- Source before target, because the checks below now run ahead of the read that
  -- used to reject first: without this a viewer of the source would be told about
  -- its target membership instead of getting the read's generic 'Story not found',
  -- which is what keeps viewer-of-source indistinguishable from non-member.
  if not (coalesce(public.project_role(v_source_project), '') = any(v_roles)) then
    raise exception 'Story not found';
  end if;

  if not (coalesce(public.project_role(p_target_project_id), '') = any(v_roles)) then
    raise exception 'Not a member of the target project';
  end if;
  if v_source_project = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  -- Both project rows pinned here, source first, and read once each. archived_at
  -- and the point scale are enforced nowhere but in this function, so a settings
  -- PATCH landing during any wait below would otherwise decide against a value
  -- this transaction has already used. Source-then-target is a fixed order so two
  -- opposite copies between the same pair cannot build a cycle out of them.
  select archived_at into v_source_archived
    from public.projects where id = v_source_project
    for share;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  select archived_at, public.point_scale_values(point_scale, custom_points)
    into v_target_archived, v_allowed_points
    from public.projects where id = p_target_project_id
    for share;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  select * into v_story from public.stories
    where id = p_story_id
      and project_id = v_source_project
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role = any(v_roles)
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- A container has no self-contained content to copy (its work lives in its
  -- children); Copy of a container is forbidden alongside Move (doc-18 §8).
  if v_story.is_container then
    raise exception 'A container cannot be copied — copy or regroup its children instead' using errcode = 'P0001';
  end if;

  -- story_number is contended by every numbering path in the target project,
  -- so this wait is unbounded in practice. Re-assert BOTH sides: the caller
  -- can lose write access to either project while parked here. The source
  -- membership subquery in the read above stays as it is, for the same
  -- story-existence reason as split_story.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  if v_story.points is null then
    v_points := null;
  else
    v_points := (select v_story.points where v_story.points = any(v_allowed_points));
  end if;

  -- Pinned out of tier order: which membership row matters is only known from the
  -- locked story read. spec/features.md keeps the assignee only if they are a
  -- member of the target, and the INSERT below can wait, so the row has to be
  -- held rather than merely tested. A row that does not exist locks nothing,
  -- which is the same answer as before: drop the assignee.
  if v_story.assignee_id is null then
    v_assignee := null;
  else
    perform 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
      for share;
    v_assignee := case when found then v_story.assignee_id else null end;
  end if;

  insert into public.stories (
    project_id, title, description, story_type, points,
    assignee_id, created_by
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    v_points, v_assignee, auth.uid()
  )
  returning id, number into v_new_id, v_new_number;

  insert into public.tasks (story_id, title, is_done, position)
  select v_new_id, title, is_done, position from public.tasks where story_id = p_story_id;

  for v_label in
    select l.name, l.color from public.story_labels sl
    join public.labels l on l.id = sl.label_id
    where sl.story_id = p_story_id
  loop
    select id into v_target_label from public.labels
      where project_id = p_target_project_id and name = v_label.name
      order by id limit 1;

    if v_target_label is null then
      insert into public.labels (project_id, name, color)
      values (p_target_project_id, v_label.name, v_label.color)
      returning id into v_target_label;
    end if;

    insert into public.story_labels (story_id, label_id)
    values (v_new_id, v_target_label)
    on conflict (story_id, label_id) do nothing;
  end loop;

  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    p_target_project_id, v_new_id, auth.uid(), 'story.copied_in',
    jsonb_build_object('source_project_id', v_story.project_id, 'source_story_id', p_story_id, 'title', v_story.title)
  );

  -- Exit guard for the ROLE only. Enumerating this function's waits does not
  -- terminate — an UPDATE waits on a tuple lock, an INSERT on a foreign-key row,
  -- a trigger on whatever it calls — so the guard goes after every write rather
  -- than after each wait. Nothing above is durable until commit, so raising here
  -- rolls all of it back. archived_at, the point scale and the assignee's
  -- membership need no counterpart here: all three rows are pinned.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

-- ── reshape_current_iteration ────────────────────────────────────────────────
create or replace function public.reshape_current_iteration(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- One list for every assertion in this function, so they cannot drift.
  v_roles text[] := array['owner', 'member'];
  v_length int;
  v_today date := (now() at time zone 'utc')::date;
  v_id uuid;
  v_number int;
  v_start_date date;
  v_old_end_date date;
  v_state text;
  v_new_end date;
begin
  perform public.require_project_role(p_project_id, variadic v_roles);

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));

  -- Re-check authorization under the lock (TASK-116): the caller may have
  -- been de-membered while blocked waiting for it. Same reasoning as
  -- override_iteration_length above.
  perform public.require_project_role(p_project_id, variadic v_roles);

  -- Read once, here, and pinned: the settings save that triggers this call is a
  -- separate transaction, so a second save can commit while this one waits for
  -- the lock, and the end date below is derived from the length rather than
  -- merely checked against it. Zero rows means the project was deleted during
  -- the wait — require_project_role passed before it.
  select iteration_length into v_length
    from public.projects where id = p_project_id
    for share;
  if v_length is null then
    raise exception 'Project not found';
  end if;

  -- The current iteration is the latest non-... whichever row a rollover last
  -- left in place; re-read under the lock (a rollover racing this call may
  -- have finished it and started its successor).
  select id, number, start_date, end_date, state
    into v_id, v_number, v_start_date, v_old_end_date, v_state
    from public.iterations
    where project_id = p_project_id
    order by number desc
    limit 1;

  -- No current iteration yet (a brand-new project reached via a Settings
  -- deep-link before /board ran ensureCurrentIteration): nothing to reshape,
  -- and the new length already applies to the first iteration when it's
  -- created. A benign no-op, not an error — and it keeps the NULL start_date
  -- out of the arithmetic below.
  if v_id is null then
    return jsonb_build_object('kind', 'noop', 'reason', 'no_current_iteration', 'project_id', p_project_id);
  end if;
  if v_state = 'done' then
    return jsonb_build_object('kind', 'noop', 'reason', 'already_finished', 'project_id', p_project_id);
  end if;

  -- Re-derive the end date from the (already-updated) project length, exactly
  -- as finalize_iteration would for a fresh row starting on this start_date.
  if v_length = 1 then
    v_new_end := coalesce(public.next_working_day(p_project_id, v_start_date + 1), v_start_date + 1) - 1;
  else
    v_new_end := v_start_date + (v_length - 1);
  end if;

  -- Shrinking a running sprint so its new end lands before today (or before
  -- its own start) isn't a reshape — that's a "finish early", which has its
  -- own confirmed action. Leave the current iteration untouched (the length
  -- change still took effect for the next one); report why rather than raise,
  -- so the caller's plain settings save never 500s.
  if v_new_end < greatest(v_start_date, v_today) then
    return jsonb_build_object('kind', 'noop', 'reason', 'would_end_in_past', 'project_id', p_project_id);
  end if;
  if v_new_end > v_start_date + 89 then
    return jsonb_build_object('kind', 'noop', 'reason', 'too_long', 'project_id', p_project_id);
  end if;
  if v_new_end = v_old_end_date then
    return jsonb_build_object('kind', 'unchanged', 'number', v_number, 'project_id', p_project_id);
  end if;

  update public.iterations set end_date = v_new_end where id = v_id;

  -- Recorded like override: this moves a live sprint boundary. auth.uid()
  -- unqualified — the project_role() gate above can't pass for a null uid.
  insert into public.activity_logs (project_id, actor_id, action, payload)
  values (
    p_project_id, auth.uid(), 'iteration.reshaped',
    jsonb_build_object('number', v_number, 'from', v_old_end_date, 'to', v_new_end, 'length', v_length)
  );

  -- Exit guard for the ROLE only (spec/rls.md "Pin the config a SECURITY DEFINER
  -- RPC enforces itself"). The checks above cover the advisory lock, but the
  -- writes between them and here can each wait on a tuple, a foreign key, or a
  -- trigger. Only this return is guarded: the earlier noop returns write nothing,
  -- so rejecting them would turn a harmless no-op into an error.
  perform public.require_project_role(p_project_id, variadic v_roles);

  return jsonb_build_object(
    'kind', 'reshaped', 'number', v_number, 'project_id', p_project_id, 'end_date', v_new_end
  );
end;
$function$;

-- ── finish_story_from_git ────────────────────────────────────────────────────
-- 20260728100000 read the configuration after both waits and called that the
-- only safe place. It is not: the read still raced this transaction's own commit,
-- and it left the forward-only comparison keyed on unlocked project_states rows.
-- Pinned instead, which also lets the integration row move back ABOVE the story
-- row lock where the three-tier order wants it.
create or replace function public.finish_story_from_git(p_project_id uuid, p_story_number integer, p_provider text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lock_key bigint := hashtext('iteration_finalize:' || p_project_id::text);
  v_target_state_id uuid;
  v_target_category text;
  v_target_position int;
  v_target_rank int;
  v_story record;
  v_story_category text;
  v_story_position int;
  v_story_rank int;
  v_current_id uuid;
  v_current_number int;
  v_needs_iteration boolean;
begin
  if not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'project_not_found'));
  end if;

  -- Same key finalize_iteration uses: serializes this finish+assign against
  -- rollover/manual finish so the current iteration can't finalize between
  -- the transition and the assignment below.
  perform pg_advisory_xact_lock(v_lock_key);

  -- reorder_project_state's key, and create_project_state's. Each of them writes
  -- two project_states rows in an order of its own choosing, and this function
  -- holds several of them in share, so without this the two interleave into a
  -- cycle. No function takes these two keys in the opposite order.
  perform pg_advisory_xact_lock(hashtext('project_states_positions:' || p_project_id::text));

  -- The integration row and its merge target are enforced nowhere but inside this
  -- function, so both are pinned rather than re-checked: an owner disabling the
  -- integration or repointing it during any wait below now blocks until this
  -- transaction ends. integrations is UNIQUE (project_id, provider), so pinning
  -- the row for this provider cannot be sidestepped by inserting another.
  select (i.config->>'merge_target_state_id')::uuid into v_target_state_id
    from public.integrations i
    where i.project_id = p_project_id and i.provider = p_provider and i.is_active
    limit 1
    for share;

  if v_target_state_id is null then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'not_configured'));
  end if;

  -- Pinned for the same reason, plus one this function had wrong: `position` is
  -- half of the forward-only test below, so a reorder committing between the read
  -- and the UPDATE could make the transition this function commits a BACKWARDS
  -- one. The whole set in one statement, in id order, above the story row lock:
  -- the other row the comparison reads is the story's own, known only after that
  -- lock, and pinning it there deadlocks against a state delete (see the header).
  perform 1 from public.project_states
    where project_id = p_project_id
    order by id
    for share;

  select category, position into v_target_category, v_target_position
    from public.project_states
    where id = v_target_state_id and project_id = p_project_id;

  -- Dangling (renamed/deleted since configured) or misconfigured
  -- (done/rejected) target — fail closed rather than write anything.
  if v_target_category is null or v_target_category in ('done', 'rejected') then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'target_state_invalid'));
  end if;
  v_target_rank := case v_target_category when 'unstarted' then 0 else 1 end; -- 'in_progress'

  select id, iteration_id, state_id, story_type, points into v_story
    from public.stories
    where project_id = p_project_id and number = p_story_number
    for update;
  if not found then
    return jsonb_build_array(jsonb_build_object('kind', 'not_transitionable', 'number', p_story_number));
  end if;

  -- Already pinned: the composite FK keeps this row in the set locked above.
  if v_story.state_id is not null then
    select category, position into v_story_category, v_story_position
      from public.project_states where id = v_story.state_id;
    v_story_rank := case v_story_category
      when 'unstarted' then 0
      when 'in_progress' then 1
      else 2 -- done / rejected: already past anything the target could be
    end;
  else
    v_story_rank := -1; -- Icebox: before everything
    v_story_position := -1;
  end if;

  if v_story_rank > v_target_rank
     or (v_story_rank = v_target_rank and v_story_position >= v_target_position) then
    return jsonb_build_array(jsonb_build_object('kind', 'not_transitionable', 'number', p_story_number));
  end if;

  -- An unestimated feature cannot enter a non-unstarted state
  -- (stories_enforce_board_invariants). Report it the same way as every other
  -- precondition this function declines on: git-webhook turns a raised
  -- exception into a 500, and the provider would then redeliver a merge that
  -- can never succeed — taking every later story number in the same push down
  -- with it. Scoped to a non-unstarted target, since a project may legitimately
  -- point merge_target_state_id at an unstarted state, which stays open to
  -- unestimated work.
  if v_target_category <> 'unstarted'
     and v_story.story_type = 'feature' and v_story.points is null then
    return jsonb_build_array(jsonb_build_object(
      'kind', 'ignored', 'number', p_story_number, 'reason', 'unestimated'
    ));
  end if;

  -- A story force-finished from the Backlog/Icebox (no iteration) would be
  -- stranded there (only an unstarted-category state may cross zones on
  -- the board, and the Kanban board renders no Backlog/Icebox columns at
  -- all), so it must be pulled into the current iteration — a merged PR
  -- means the work happened in this iteration. Resolved BEFORE writing
  -- state_id: iterations are lazy-created on Board visit, so a project
  -- nobody has opened yet may have none, and writing state_id first would
  -- leave such a story with its target state but no iteration — invisible
  -- on the board. Fail closed instead: if an iteration is needed and none
  -- exists, change nothing.
  v_needs_iteration := v_story.iteration_id is null;
  if v_needs_iteration then
    select id, number into v_current_id, v_current_number
      from public.iterations
      where project_id = p_project_id and state <> 'done'
      order by number desc
      limit 1;

    if v_current_id is null then
      return jsonb_build_array(jsonb_build_object(
        'kind', 'ignored', 'number', p_story_number, 'reason', 'no_active_iteration'
      ));
    end if;
  end if;

  -- One statement, not state_id then iteration_id: the two-write version left
  -- the row transiently at its target state with no iteration, which is exactly
  -- the shape the comment above says must never exist and which
  -- stories_enforce_board_invariants (TASK-208) now rejects.
  update public.stories
    set state_id = v_target_state_id,
        iteration_id = case when v_needs_iteration then v_current_id else iteration_id end
    where id = v_story.id;

  if v_needs_iteration then
    return jsonb_build_array(jsonb_build_object(
      'kind', 'finished', 'number', p_story_number, 'iteration_number', v_current_number
    ));
  end if;

  return jsonb_build_array(jsonb_build_object('kind', 'finished', 'number', p_story_number));
end;
$function$;

-- ── assert_points_on_scale ───────────────────────────────────────────────────
-- Dropped: its three callers (split_story, move/copy) pin the scale instead, so
-- it had no caller left, and it held the seventh copy of the literals that
-- point_scale_values now owns.
drop function public.assert_points_on_scale(uuid, uuid);

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   point_scale_values        -> drop function public.point_scale_values(text, int[])
--   assert_points_on_scale    -> restore from 20260728073000_recheck_role_after_lock.sql
--   update_story              -> 20260728061500_update_story_keep_offscale_estimate.sql
--   split_story               -> 20260730000000_split_story_lock_order.sql
--   move/copy_story_to_project-> 20260730010000_move_copy_lock_order.sql
--   reshape_current_iteration -> 20260728120000_iteration_rpc_exit_guards.sql
--   finish_story_from_git     -> 20260728100000_finish_story_from_git_config_after_lock.sql
-- Reverting reinstates the per-value exit checks, which this migration's header
-- explains are unsound rather than merely incomplete.
-- ============================================================
