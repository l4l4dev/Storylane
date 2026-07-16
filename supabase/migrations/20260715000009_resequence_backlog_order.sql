-- ============================================================
-- TASK-56 slice 2: resequence_backlog_order — migration-period wrapper that
-- runs a full backlog position rewrite under the SAME advisory lock as
-- move_story_board (20260715000008), so the two can't interleave their
-- position writes on one project.
--
-- After slice 2, persistBacklogOrder (apps/web/.../board/actions.ts) is only
-- reached by createBacklogDivider and quickCreateStory's backlog branch — the
-- drop paths now go through move_story_board. Those inserts still compute a
-- full ordered sequence client/action-side (the read-merge-splice stays
-- outside the lock; full insert atomicity is TASK-51's insert_board_item), but
-- the WRITE must serialize with concurrent board moves or the two dense
-- rewrites race and reintroduce duplicate/gapped positions.
--
-- Lock order: this function takes ONLY the positions key. move_story_board
-- takes iteration_finalize THEN positions; nothing takes positions before
-- finalize, so no cycle is possible.
--
-- The dense write itself reuses _resequence_backlog (20260715000008), shared
-- with TASK-51.
-- ============================================================

create function public.resequence_backlog_order(
  p_project_id uuid,
  p_kinds text[],
  p_story_ids uuid[],
  p_divider_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_story_count int;
  v_divider_count int;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  -- The two id arrays are the story/divider slots of p_kinds in order — their
  -- counts must line up, or _resequence_backlog would index past an array end
  -- (or leave a slot unused). Guard before touching any row.
  if (select count(*) from unnest(p_kinds) k where k = 'story') <> coalesce(array_length(p_story_ids, 1), 0)
     or (select count(*) from unnest(p_kinds) k where k = 'divider') <> coalesce(array_length(p_divider_ids, 1), 0)
     or (select count(*) from unnest(p_kinds) k where k not in ('story', 'divider')) > 0 then
    raise exception 'kind/id array length mismatch' using errcode = 'P0001';
  end if;

  -- Cross-tenant guard: SECURITY DEFINER bypasses RLS, and the id arrays are
  -- caller-supplied, so without this a caller could pass another project's id
  -- and _resequence_backlog would overwrite that foreign row's position. Every
  -- id must belong to p_project_id (mirrors move_story_board's divider guard).
  select count(*) into v_story_count
    from public.stories where id = any(p_story_ids) and project_id = p_project_id;
  if v_story_count <> coalesce(array_length(p_story_ids, 1), 0) then
    raise exception 'story not in project' using errcode = 'P0002';
  end if;

  select count(*) into v_divider_count
    from public.backlog_dividers where id = any(p_divider_ids) and project_id = p_project_id;
  if v_divider_count <> coalesce(array_length(p_divider_ids, 1), 0) then
    raise exception 'divider not in project' using errcode = 'P0002';
  end if;

  perform public._resequence_backlog(p_kinds, p_story_ids, p_divider_ids);
end;
$$;

-- Per the TASK-55 grant lockdown: revoke the implicit PUBLIC/authenticated
-- grants CREATE adds, then re-grant EXECUTE to authenticated explicitly. Keep
-- the grant-lockdown allowlist test in sync.
revoke execute on function public.resequence_backlog_order(uuid, text[], uuid[], uuid[]) from public, authenticated;
grant execute on function public.resequence_backlog_order(uuid, text[], uuid[], uuid[]) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.resequence_backlog_order(uuid, text[], uuid[], uuid[]);
