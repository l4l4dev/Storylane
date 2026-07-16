-- ============================================================
-- TASK-58 slice 2a fix: make every positioned INSERT consume the sequence.
-- Advisor-approved (Fable, 2026-07-16).
--
-- 20260716000004 gave `position` a sequence default and claimed nextval always
-- exceeds every stored position. That does not hold on its own: the rewrite
-- paths write dense ranks 0..n-1, and n grows with each INSERT that skips the
-- default. Measured on a fresh project: five insert_board_item calls (which
-- pass an explicit position 0) produced positions {0,1,2,3,4} while the
-- sequence stayed put — so a later default insert could land mid-zone, or even
-- share a position with an existing row.
--
-- The invariant the design actually needs:
--
--   Every INSERT into a positioned table takes its position from the sequence.
--   Rewrites only ever write ranks, and a rank is < the row count.
--
-- Given that, with the sequence based at greatest(max(position), row count) + 1:
--   rank < row count <= base row count + inserts since <= frontier
-- so nextval outruns every stored value, and each default insert appends. The
-- rewrites (_splice_backlog, move_story_board, swap_adjacent) need no change —
-- a rank is bounded by the row count, and the row count is bounded by the
-- frontier only while every insert consumes.
--
-- backlog_dividers therefore has to draw from stories_position_seq rather than
-- its own: it shares the backlog's single order space with stories
-- (spec/data-model.md "shares one dense sequence"), so the merged backlog rank
-- is bounded by stories + dividers, and only a shared sequence counts both.
-- ============================================================

-- Dividers join the stories sequence (they had no sequence of their own; their
-- position still defaulted to the literal 0 from 20260707000001). USAGE on the
-- sequence is already granted (20260716000004 + the blanket grant in
-- 20260630000002), so no new grant is needed for dividers to draw from it.
alter table public.backlog_dividers
  alter column position set default nextval('public.stories_position_seq');

-- Re-base every sequence above BOTH the highest position and the row count.
-- 20260716000004 based them on max(position) + 1 only, which is short whenever
-- several zones are each densely numbered (their ranks overlap, so the row
-- count exceeds the maximum). stories is based over stories + dividers because
-- they now share the sequence.
do $$
declare
  v_table text;
  v_next int;
begin
  select greatest(
           (select coalesce(max(position), 0) from public.stories),
           (select count(*) from public.stories) + (select count(*) from public.backlog_dividers),
           (select coalesce(max(position), 0) from public.backlog_dividers)
         ) + 1
    into v_next;
  perform setval('public.stories_position_seq', v_next, false);

  foreach v_table in array array['tasks', 'epics', 'custom_statuses', 'swimlanes']
  loop
    execute format(
      'select greatest(coalesce(max(position), 0), count(*)) + 1 from public.%I', v_table
    ) into v_next;
    execute format('select setval(%L, %s, false)', 'public.' || v_table || '_position_seq', v_next);
  end loop;
end;
$$;

-- insert_board_item: drop the explicit placeholder 0 so the row consumes the
-- sequence. _splice_backlog immediately rewrites it to its rank, so the
-- default's only job is to keep the frontier ahead of the row count — the
-- placeholder never had to be 0. Re-created from 20260716000001 word-for-word
-- apart from the two insert column lists.
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
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  -- Validate + create in the DB (decision-1: invariants live server-side; this
  -- is SECURITY DEFINER and client-callable, so the TS early-returns are a
  -- convenience, not the guarantee). created_by defaults to auth.uid(), which
  -- resolves from the JWT even under SECURITY DEFINER.
  if p_kind = 'story' then
    v_title := btrim(coalesce(p_payload->>'title', ''));
    if v_title = '' then
      raise exception 'title required' using errcode = 'P0001';
    end if;
    insert into public.stories (project_id, title, story_type, state, iteration_id)
      values (p_project_id, v_title, 'feature', 'unstarted', null)
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

revoke execute on function public.insert_board_item(uuid, text, jsonb, jsonb) from public, authenticated;
grant execute on function public.insert_board_item(uuid, text, jsonb, jsonb) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.backlog_dividers alter column position set default 0;
-- (restore insert_board_item from 20260716000001)
