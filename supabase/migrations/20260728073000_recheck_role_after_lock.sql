-- ============================================================
-- TASK-211: re-assert authorization AFTER the advisory lock in every RPC that
-- takes one.
--
-- Each of these checks the caller's role, then takes a lock that can block for
-- an unbounded time, then writes. A caller demoted or removed while parked on
-- that lock still completed the write. project_role() is STABLE, but every
-- PL/pgSQL statement gets its own READ COMMITTED snapshot, so a second call
-- after the lock sees a revocation that committed during the wait. All of these
-- are SECURITY DEFINER, so RLS never re-evaluates on their writes and the
-- re-check has to be explicit — the same reasoning 20260722000006 (cadence) and
-- 20260722000010 (finalize_iteration) already recorded.
--
-- Where the role set is a plain list it is hoisted into a variable so the pre-
-- and post-lock checks cannot drift apart; a drift silently reopens the window.
--
-- invite_member still takes no lock: nothing here needs serialising, because the
-- unique constraint already makes concurrent invites atomic, and a lock would
-- stall every invite behind unrelated demotions in the same project. It is not
-- waitless though — `on conflict (project_id, user_id) do nothing` blocks on a
-- conflicting tuple that an in-flight remove_member is deleting, and that
-- transaction may itself be parked on membership:<project>. Its re-check
-- therefore sits AFTER the insert, where raising rolls the insert back.
--
-- Two guards deliberately keep their bespoke shape rather than moving to
-- require_project_role:
--   * remove_member permits a non-owner to remove THEMSELVES, which a plain
--     role-list check would reject (spec/rls.md "RPC role guards").
--   * split_story / move_story_to_project / copy_story_to_project authorize the
--     SOURCE story through a membership subquery inside `select ... for update`,
--     so an inaccessible story and a nonexistent one both surface as "Story not
--     found". Splitting them apart would confirm that a story exists in a project
--     the caller cannot see. The post-lock re-check keys off the project_id that
--     read already established, which leaks nothing new.
--
-- Each body below is the CURRENT definition read back from the database, so the
-- behaviour that accumulated since each function's first migration is preserved
-- (remove_member's my_work_story_state purge, split_story's duplicate-task_id
-- rejection, the cross-project container and archive guards). Grants survive
-- CREATE OR REPLACE.
-- ============================================================

-- ── change_member_role ─────────────────────────────────────────────────────
create or replace function public.change_member_role(p_project_id uuid, p_user_id uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- One source for both checks: if they could drift, the window reopens.
  v_roles text[] := array['owner'];
begin
  perform public.require_project_role(p_project_id, variadic v_roles);

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'Invalid role: %', p_role;
  end if;

  perform pg_advisory_xact_lock(hashtext('membership:' || p_project_id::text));

  -- The pre-lock check is not enough on its own: the wait for this lock is
  -- unbounded, so an owner who is demoted while parked here would otherwise
  -- still write. project_role() is STABLE, but each statement gets its own
  -- READ COMMITTED snapshot, so this second call sees a revocation committed
  -- during the wait. SECURITY DEFINER means no RLS re-evaluation happens on
  -- the UPDATE below, so the check has to be explicit.
  perform public.require_project_role(p_project_id, variadic v_roles);

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  ) then
    raise exception 'That user is not a member of this project';
  end if;

  -- Last-owner invariant: only a demotion can strip the final owner. Count
  -- runs under the lock taken above so a concurrent demotion can't also pass.
  if p_role <> 'owner' then
    perform public.assert_not_last_owner(p_project_id, p_user_id);
  end if;

  update public.project_members set role = p_role
  where project_id = p_project_id and user_id = p_user_id;
end;
$function$;

-- ── remove_member ─────────────────────────────────────────────────────
create or replace function public.remove_member(p_project_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text := public.project_role(p_project_id);
begin
  if v_caller_role is null then
    -- Outsider with no membership row — not a member of this project at all.
    raise exception 'Not a member of this project';
  end if;
  if v_caller_role <> 'owner' and auth.uid() is distinct from p_user_id then
    raise exception 'Only project owners can remove other members';
  end if;

  perform pg_advisory_xact_lock(hashtext('membership:' || p_project_id::text));

  -- Re-run the entry guard: the wait above is unbounded, and a caller demoted
  -- meanwhile must not still remove somebody. Re-evaluated in full rather than
  -- swapped for require_project_role(...,'owner') because the rule is not a
  -- plain role list — a non-owner may always remove themselves.
  v_caller_role := public.project_role(p_project_id);
  if v_caller_role is null then
    if auth.uid() is not distinct from p_user_id then
      -- Self-leave that another owner completed while this call was parked. The
      -- caller's membership is already gone, which is exactly what they asked
      -- for, so keep the idempotent contract the not-a-member branch below
      -- gives every other already-done removal instead of erroring.
      return;
    end if;
    raise exception 'Not a member of this project';
  end if;
  if v_caller_role <> 'owner' and auth.uid() is distinct from p_user_id then
    raise exception 'Only project owners can remove other members';
  end if;

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  ) then
    -- Idempotent: already not a member.
    return;
  end if;

  perform public.assert_not_last_owner(p_project_id, p_user_id);

  -- My Work marks are keyed on the story, not on membership, so nothing else
  -- clears them when a member leaves — and a re-invite would otherwise revive
  -- marks the user set before they were removed. (story_completions is the
  -- append-only Done LOG and is intentionally NOT purged — it survives leaving
  -- the project, per doc-14; only the mutable is_today/local_status marks go.)
  delete from public.my_work_story_state mws
    using public.stories s
    where mws.story_id = s.id
      and mws.user_id = p_user_id
      and s.project_id = p_project_id;

  delete from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
end;
$function$;

-- ── move_story_board ─────────────────────────────────────────────────────
create or replace function public.move_story_board(p_project_id uuid, p_item jsonb, p_view text, p_expected jsonb, p_deltas jsonb, p_anchor jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_role text;
  v_kind text := p_item->>'kind';
  v_id uuid := (p_item->>'id')::uuid;
  v_story record;
  v_current_id uuid;
  v_new_state_id uuid;
  v_state_set boolean;
  v_new_iteration uuid;
  v_new_parent uuid;
  v_zone text;
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
  v_was_in_scope boolean;
  v_old_pos int;
  v_before_pos int;
  v_target int;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or not (v_role = any(v_roles)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  -- Both locks are held now, and both can block for an unbounded time. Nothing
  -- re-read under them carries membership, so the role has to be re-asserted
  -- explicitly; SECURITY DEFINER means the writes below get no RLS re-check.
  -- One STABLE index lookup, against an O(N) position shift.
  perform public.require_project_role(p_project_id, variadic v_roles);

  select id into v_current_id
    from public.iterations
    where project_id = p_project_id and state <> 'done'
    order by number desc
    limit 1;

  if v_kind = 'story' then
    select state_id, iteration_id, position, parent_id
      into v_story
      from public.stories
      where id = v_id and project_id = p_project_id
      for update;
    if not found then
      raise exception 'story not found' using errcode = 'P0002';
    end if;

    -- parent_id joins the snapshot now that this RPC writes it: a concurrent
    -- Split or Parent-picker reparent must be caught here, exactly as a
    -- concurrent state/iteration change already is.
    --
    -- `->>` cannot tell an absent key from a JSON null, so a caller that omits
    -- parent_id entirely would silently compare against NULL and permanently
    -- reject every move of a parented story as "stale" — a lie that survives
    -- any number of retries. Demand the key instead, so a caller predating this
    -- contract (an old bundle still served mid-deploy) fails with a message
    -- that names the real cause.
    if not (p_expected ? 'parent_id') then
      raise exception 'p_expected.parent_id is required' using errcode = 'P0001';
    end if;
    if v_story.state_id is distinct from (p_expected->>'state_id')::uuid
       or v_story.iteration_id is distinct from (p_expected->>'iteration_id')::uuid
       or v_story.parent_id is distinct from (p_expected->>'parent_id')::uuid then
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
    v_new_parent := case when p_deltas ? 'parent_id' then (p_deltas->>'parent_id')::uuid else v_story.parent_id end;

    update public.stories
      set state_id = v_new_state_id,
          iteration_id = v_new_iteration
      where id = v_id;

    -- Kept out of the statement above, and skipped entirely when the parent is
    -- unchanged, so the `update of parent_id` triggers
    -- (enforce_single_level_nesting, maintain_is_container) fire only on a real
    -- reparent rather than on every board drag. They are the sole authority on
    -- hierarchy legality and containerization — this RPC re-implements neither
    -- (doc-18 §3/§4).
    if v_new_parent is distinct from v_story.parent_id then
      update public.stories set parent_id = v_new_parent where id = v_id;
    end if;
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
  elsif v_new_state_id is not null
        and (v_current_id is null or v_new_iteration is distinct from v_current_id) then
    -- A state-bearing story whose destination isn't the current iteration.
    -- List view: a legitimate current→backlog drag (v_new_iteration = null),
    -- spliced into the backlog sequence below. Any other view (tracker — whose
    -- columns are always the current iteration — or a forged p_view): reject,
    -- so the single-zone rewrite can't renumber it into the wrong iteration's
    -- sequence (TASK-134). The story row's own state/iteration were already set
    -- above; the raise rolls the whole transaction back.
    if p_view <> 'list' then
      raise exception 'stale story state; refresh and retry' using errcode = 'P0001';
    end if;
    v_zone := 'backlog';
  else
    v_zone := 'single';
  end if;

  if v_zone = 'single' then
    -- A Kanban column-end drop gives no anchor (dropped after the column's
    -- last card). Translate it to the iteration-wide anchor so the card lands
    -- right after its own column's tail, not at the whole iteration's bottom.
    -- Null-safe: an empty column (no tail) or a tail that is also the
    -- iteration tail leaves v_before_id null → append at the sequence's end.
    if p_view = 'tracker' and v_before_id is null
       and v_new_state_id is not null and v_new_iteration is not null then
      with iter_stories as (
        select id, position, state_id from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
      )
      select id into v_before_id
        from iter_stories
        where position > (
          select max(position) from iter_stories
          where state_id is not distinct from v_new_state_id
        )
        order by position
        limit 1;
    end if;

    -- One iteration-scoped sequence for both views: the current iteration as a
    -- whole (or the Icebox's own null-state set), never a single state column.
    -- The scope predicate (reused verbatim below) is the moved story's NEW
    -- home: the current iteration for a board move, all state-null stories for
    -- an Icebox move.
    v_old_pos := v_story.position;
    if v_before_id = v_id then
      v_before_id := null; -- defensive: never anchor a story before itself
    end if;

    -- Was the story already part of this sequence (its PRE-update state/
    -- iteration)? If so its old position is a real slot to move FROM (bounded
    -- range shift); if not, it's entering and we insert (shift target..end).
    v_was_in_scope := case
      when v_new_state_id is null then v_story.state_id is null
      else v_story.iteration_id is not distinct from v_new_iteration
    end;

    if v_before_id is not null then
      select position into v_before_pos
        from public.stories
        where id = v_before_id and project_id = p_project_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end;
    end if;

    if v_before_pos is null then
      -- Append (no anchor, or an anchor not in this sequence). Land past the
      -- current last story: max(position)+1, NOT count(*) — positions can be
      -- sparse (a List current→backlog drag or finalize_iteration vacates a
      -- slot and nothing re-densifies), so a count would land the card
      -- mid-sequence. No shift: the card jumps past the max and its own old
      -- slot, if any, is left as a gap — consistent with this function's
      -- minimal-touch, gap-tolerant model.
      select coalesce(max(position), -1) + 1 into v_target
        from public.stories
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end;
      update public.stories set position = v_target where id = v_id;
      return;
    end if;

    -- Anchored move: land immediately before v_before_id via a bounded range
    -- shift — only rows between the vacated old slot and the target move,
    -- everything outside keeps its position.
    if v_was_in_scope and v_old_pos < v_before_pos then
      v_target := v_before_pos - 1; -- moving down
      update public.stories set position = position - 1
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end
          and position > v_old_pos and position <= v_target;
    elsif v_was_in_scope then
      v_target := v_before_pos; -- moving up
      update public.stories set position = position + 1
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end
          and position >= v_target and position < v_old_pos;
    else
      -- Entering the sequence with an anchor: open a slot at the target
      -- (shifts target..end — O(N) worst case, inherent to dense-int positions).
      v_target := v_before_pos;
      update public.stories set position = position + 1
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end
          and position >= v_target;
    end if;

    update public.stories set position = v_target where id = v_id;
    return;
  end if;

  perform public._splice_backlog(p_project_id, v_kind, v_id, v_before_kind, v_before_id);
end;
$function$;

-- ── split_story ─────────────────────────────────────────────────────
create or replace function public.split_story(p_story_id uuid, p_children jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_source          public.stories%rowtype;
  v_src_category    text;
  v_first_unstarted uuid;
  v_child_state     uuid;
  v_child_iter      uuid;
  v_iter_done       boolean;
  v_point_scale     text;
  v_custom_pts      int[];
  v_child_points    int;
  v_child           jsonb;
  v_new_id          uuid;
  v_child_ids       uuid[] := '{}';
  v_task_ids        uuid[];
  v_all_task_ids    uuid[];
begin
  -- owner/member on the source project; also the write lock.
  select * into v_source from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role = any(v_roles)
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

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

  -- A task assigned to two children would silently drop the second request
  -- (see header) — reject up front rather than partially applying it.
  select array_agg(t) into v_all_task_ids
    from jsonb_array_elements(p_children) as c,
         jsonb_array_elements_text(coalesce(c->'task_ids', '[]'::jsonb)) as t;
  if v_all_task_ids is not null
     and array_length(v_all_task_ids, 1) <> (select count(distinct t) from unnest(v_all_task_ids) as t) then
    raise exception 'A task cannot be assigned to more than one new story' using errcode = 'P0001';
  end if;

  -- Documented lock order positions -> story_number (child inserts take the
  -- number lock); hold both to avoid AB-BA deadlock with insert_board_item et
  -- al., even though children are only appended (no compaction).
  perform pg_advisory_xact_lock(hashtext('positions:' || v_source.project_id::text));
  perform pg_advisory_xact_lock(hashtext('story_number:' || v_source.project_id::text));

  -- story_number is contended by every numbering path in the project, so the
  -- wait here is the likeliest of these to be hit. The membership subquery in
  -- the read above deliberately stays as it is: collapsing "not yours" into
  -- "Story not found" is what keeps this from confirming a story exists in a
  -- project the caller cannot see. Re-checking by project_id is safe now that
  -- the row read has already established the caller could see it.
  perform public.require_project_role(v_source.project_id, variadic v_roles);

  select point_scale, custom_points into v_point_scale, v_custom_pts
    from public.projects where id = v_source.project_id;

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
        where project_id = v_source.project_id and category = 'unstarted'
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
      v_child_points := case v_point_scale
        when 'fibonacci' then (select v_child_points where v_child_points = any(array[0, 1, 2, 3, 5, 8, 13]))
        when 'linear' then (select v_child_points where v_child_points = any(array[0, 1, 2, 3]))
        when 'custom' then (select v_child_points where v_child_points = any(coalesce(v_custom_pts, '{}')))
      end;
    end if;

    -- position omitted: default nextval appends at the sequence frontier
    -- (position invariant rule 1). assignee never inherited (§7).
    insert into public.stories (
      project_id, parent_id, title, description, story_type, points,
      state_id, iteration_id, epic_color, assignee_id, created_by
    ) values (
      v_source.project_id, p_story_id,
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
    v_source.project_id, p_story_id, auth.uid(), 'story.split',
    jsonb_build_object('child_ids', to_jsonb(v_child_ids), 'child_count', array_length(v_child_ids, 1))
  );

  return jsonb_build_object('parent_id', p_story_id, 'child_ids', to_jsonb(v_child_ids));
end;
$function$;

-- ── move_story_to_project ─────────────────────────────────────────────────────
create or replace function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
  select * into v_story from public.stories
    where id = p_story_id
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

  if not (coalesce(public.project_role(p_target_project_id), '') = any(v_roles)) then
    raise exception 'Not a member of the target project';
  end if;
  if v_story.project_id = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  -- Only archived_at is used before the lock; the point scale is read after it,
  -- because a scale fetched here would already be stale by the time the clamp
  -- runs.
  select archived_at into v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  -- story_number is contended by every numbering path in the target project,
  -- so this wait is unbounded in practice. Re-assert BOTH sides: the caller
  -- can lose write access to either project while parked here. The source
  -- membership subquery in the read above stays as it is, for the same
  -- story-existence reason as split_story.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  -- archived_at is enforced ONLY inside these RPCs — no policy or trigger backs
  -- it up — so it needs re-reading here for the same reason the roles do, or a
  -- project archived during the wait still receives the story.
  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;
  select archived_at into v_target_archived from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;
  -- The point scale came from the same pre-lock read as archived_at and is just
  -- as stale: a scale narrowed during the wait would otherwise let the clamp
  -- below admit a value that is off the new scale, and nothing downstream
  -- re-validates points against it.
  select point_scale, custom_points into v_point_scale, v_custom_pts
    from public.projects where id = p_target_project_id;

  if v_story.points is null then
    v_points := null;
  else
    v_points := case v_point_scale
      when 'fibonacci' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3, 5, 8, 13]))
      when 'linear' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3]))
      when 'custom' then (select v_story.points where v_story.points = any(coalesce(v_custom_pts, '{}')))
    end;
  end if;

  v_assignee := case
    when v_story.assignee_id is not null and exists(
      select 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
    ) then v_story.assignee_id
    else null
  end;

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

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$function$;

-- ── copy_story_to_project ─────────────────────────────────────────────────────
create or replace function public.copy_story_to_project(p_story_id uuid, p_target_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
  select * into v_story from public.stories
    where id = p_story_id
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

  if not (coalesce(public.project_role(p_target_project_id), '') = any(v_roles)) then
    raise exception 'Not a member of the target project';
  end if;
  if v_story.project_id = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  -- Only archived_at is used before the lock; the point scale is read after it,
  -- because a scale fetched here would already be stale by the time the clamp
  -- runs.
  select archived_at into v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  -- story_number is contended by every numbering path in the target project,
  -- so this wait is unbounded in practice. Re-assert BOTH sides: the caller
  -- can lose write access to either project while parked here. The source
  -- membership subquery in the read above stays as it is, for the same
  -- story-existence reason as split_story.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  -- archived_at is enforced ONLY inside these RPCs — no policy or trigger backs
  -- it up — so it needs re-reading here for the same reason the roles do, or a
  -- project archived during the wait still receives the story.
  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;
  select archived_at into v_target_archived from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;
  -- The point scale came from the same pre-lock read as archived_at and is just
  -- as stale: a scale narrowed during the wait would otherwise let the clamp
  -- below admit a value that is off the new scale, and nothing downstream
  -- re-validates points against it.
  select point_scale, custom_points into v_point_scale, v_custom_pts
    from public.projects where id = p_target_project_id;

  if v_story.points is null then
    v_points := null;
  else
    v_points := case v_point_scale
      when 'fibonacci' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3, 5, 8, 13]))
      when 'linear' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3]))
      when 'custom' then (select v_story.points where v_story.points = any(coalesce(v_custom_pts, '{}')))
    end;
  end if;

  v_assignee := case
    when v_story.assignee_id is not null and exists(
      select 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
    ) then v_story.assignee_id
    else null
  end;

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

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$function$;

-- ── insert_board_item ───────────────────────
create or replace function public.insert_board_item(p_project_id uuid, p_kind text, p_payload jsonb, p_anchor jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
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
  if v_role is null or not (v_role = any(v_roles)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  -- Same window the rest of this migration closes: the wait above is
  -- unbounded, and SECURITY DEFINER means the writes below get no RLS
  -- re-evaluation to fall back on.
  perform public.require_project_role(p_project_id, variadic v_roles);

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
$function$;

-- ── create_project_state ───────────────────────
create or replace function public.create_project_state(p_project_id uuid, p_name text, p_category text, p_action_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_category_rank int;
  v_position int;
  v_id uuid;
begin
  if p_category not in ('unstarted', 'in_progress', 'done', 'rejected') then
    raise exception 'invalid category' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name is required' using errcode = 'P0001';
  end if;

  perform public.require_project_role(p_project_id, variadic v_roles);

  perform pg_advisory_xact_lock(hashtext('project_states_positions:' || p_project_id::text));

  -- Same window the rest of this migration closes: the wait above is
  -- unbounded, and SECURITY DEFINER means the writes below get no RLS
  -- re-evaluation to fall back on.
  perform public.require_project_role(p_project_id, variadic v_roles);

  v_category_rank := case p_category
    when 'unstarted' then 0
    when 'in_progress' then 1
    when 'done' then 2
    else 3 -- 'rejected'
  end;

  select coalesce(max(position), -1) + 1 into v_position
    from public.project_states
    where project_id = p_project_id
      and (case category
             when 'unstarted' then 0
             when 'in_progress' then 1
             when 'done' then 2
             else 3
           end) <= v_category_rank;

  update public.project_states
    set position = position + 1
    where project_id = p_project_id and position >= v_position;

  insert into public.project_states (project_id, name, action_label, category, position)
    values (p_project_id, trim(p_name), p_action_label, p_category, v_position)
    returning id into v_id;

  return v_id;
end;
$function$;

-- ── reorder_project_state ───────────────────────
create or replace function public.reorder_project_state(p_project_id uuid, p_state_id uuid, p_direction text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_category text;
  v_position int;
  v_neighbor_id uuid;
  v_neighbor_position int;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction' using errcode = 'P0001';
  end if;

  perform public.require_project_role(p_project_id, variadic v_roles);

  -- Dedicated `project_states_positions:` namespace (shared with
  -- create_project_state, 20260719000014), not the `positions:` key used
  -- for stories.position elsewhere — the two tables' position columns are
  -- unrelated resources and sharing one key would serialize story
  -- drag-reorders against board-column edits for no reason.
  perform pg_advisory_xact_lock(hashtext('project_states_positions:' || p_project_id::text));

  -- Same window the rest of this migration closes: the wait above is
  -- unbounded, and SECURITY DEFINER means the writes below get no RLS
  -- re-evaluation to fall back on.
  perform public.require_project_role(p_project_id, variadic v_roles);

  select category, position into v_category, v_position
    from public.project_states where id = p_state_id and project_id = p_project_id;
  if v_category is null then
    raise exception 'state not found' using errcode = 'P0002';
  end if;

  -- The nearest same-category neighbour in the requested direction — NOT
  -- necessarily adjacent in the raw position sequence, since other
  -- categories' states can sit between two same-category ones.
  if p_direction = 'up' then
    select id, position into v_neighbor_id, v_neighbor_position
      from public.project_states
      where project_id = p_project_id and category = v_category and position < v_position
      order by position desc limit 1;
  else
    select id, position into v_neighbor_id, v_neighbor_position
      from public.project_states
      where project_id = p_project_id and category = v_category and position > v_position
      order by position asc limit 1;
  end if;

  if v_neighbor_id is null then
    return; -- already at this category's edge; no-op (matches the UI's disabled arrow)
  end if;

  update public.project_states set position = v_neighbor_position where id = p_state_id;
  update public.project_states set position = v_position where id = v_neighbor_id;
end;
$function$;

-- ── invite_member ───────────────────────
create or replace function public.invite_member(p_project_id uuid, p_user_id uuid, p_role text DEFAULT 'member'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Both checks read this one list, same reason as the lock-taking RPCs.
  v_roles text[] := array['owner'];
  v_is_personal boolean;
begin
  perform public.require_project_role(p_project_id, variadic v_roles);

  select is_personal into v_is_personal from public.projects where id = p_project_id;
  if v_is_personal then
    raise exception 'The personal project cannot have members invited' using errcode = 'P0001';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'Invalid role: %', p_role;
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such user';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do nothing;

  if not found then
    raise exception 'That user is already a member of this project';
  end if;

  -- No advisory lock here on purpose — nothing needs serialising, since the
  -- unique constraint already makes concurrent invites atomic. But the insert
  -- above CAN wait: `on conflict do nothing` blocks on a conflicting tuple
  -- that an in-flight remove_member is deleting, and that transaction may
  -- itself be parked on membership:<project>. Re-assert after the wait rather
  -- than before it; raising here rolls the insert back.
  perform public.require_project_role(p_project_id, variadic v_roles);
end;
$function$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- restore each function from its prior definition:
--   change_member_role   -> 20260717000001_guard_helpers.sql
--   remove_member        -> 20260722000003_drop_story_pins.sql
--   move_story_board     -> 20260724153129_move_story_board_parent_delta.sql
--   split_story          -> 20260724123806_split_story_reject_duplicate_task_ids.sql
--   move/copy_story_to_project -> 20260724071826_epic_story_unification_split_story.sql
--   insert_board_item    -> 20260719000008_reanchor_board_mechanics.sql
--   create_project_state -> 20260719000014_create_project_state.sql
--   reorder_project_state -> 20260719000013_reorder_project_state.sql
--   invite_member        -> 20260722000014_personal_project_seal_seams.sql
-- ============================================================
