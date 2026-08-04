-- ============================================================
-- Removing a member unassigns every story they held through the composite FK's
-- on delete set null (20260730030000), and since those UPDATEs are logged
-- (20260803010000) a member holding 30 stories writes 30 story.assignee_changed
-- rows in one transaction — a page and a half of the project feed, which pages
-- 20 at a time.
--
-- The rows themselves stay: "these 30 stories need a new owner" is what a team
-- has to learn from a removal. What changes is that the FEED shows one entry for
-- them.
--
-- Why the collapse happens here, at write time, and not in the feed:
--   1. Grouping in the reader cannot work with keyset pagination. The feed's
--      next/prev links and its lookahead assume a full page of rows, so a
--      cascade spanning a page boundary would collapse to "20 stories" on one
--      page and "10 stories" on the next. Folding to one row before the reader
--      sees it is the only shape that keeps the count true.
--   2. Identifying which rows belong to one cascade cannot use a time window:
--      since 20260802000000 rows carry distinct clock_timestamp values, so no
--      window separates one cascade from unrelated writes beside it. The rows
--      carry an explicit token instead, set for the duration of the delete.
-- Rejected alternative: have the trigger infer a cascade by noticing
-- old.assignee_id is no longer a member. It needs no session variable, but it is
-- an inference rather than a fact, and it yields neither a group key nor a count.
--
-- Why a new payload key rather than `storylane.bookkeeping`: bookkeeping hides a
-- row from the story-detail panel too, and that panel is where "why did this
-- story lose its assignee?" is answered — hiding it there re-creates half of
-- what 20260803010000 just fixed. `feed_collapsed` means "the feed has one entry
-- speaking for this row", which is a feed-only claim.
-- ============================================================

-- Verbatim from 20260803010000_log_assignee_changes.sql apart from the
-- feed_collapsed key on the assignee branch. The other three branches do not
-- carry it: nothing collapses them, and a key on a row no summary speaks for
-- would hide it from the feed for good.
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
        'bookkeeping', v_bookkeeping,
        -- Set only while remove_member's delete runs, so the FK cascade's
        -- UPDATEs carry it and a member's own reassignment does not.
        'feed_collapsed', nullif(current_setting('storylane.feed_collapsed', true), '')
      )
    );
  end if;

  return new;
end;
$$;

-- Verbatim from 20260728073000_recheck_role_after_lock.sql apart from the token
-- around the delete and the summary row after it. Every guard, the advisory
-- lock, the last-owner assert and the idempotent returns are untouched.
create or replace function public.remove_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := public.project_role(p_project_id);
  v_token       text := gen_random_uuid()::text;
  v_count       int;
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

  perform set_config('storylane.feed_collapsed', v_token, true);
  delete from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
  perform set_config('storylane.feed_collapsed', '', true);

  -- Counted from the rows themselves, after the delete: an uncommitted
  -- assignment holds KEY SHARE on the membership row (20260730030000), so the
  -- delete waits for it and the cascade then unassigns that story too — a count
  -- taken beforehand would be short by exactly those.
  select count(*) into v_count
  from public.activity_logs
  where project_id = p_project_id
    and action = 'story.assignee_changed'
    and payload->>'feed_collapsed' = v_token;

  -- The entry the feed shows in place of the v_count rows above. It carries no
  -- feed_collapsed key of its own — that would filter it out with them.
  -- removal_id is the only way back from this row to the rows it speaks for,
  -- since the feed never fetches them.
  --
  -- Ids, never display names: profiles SELECT is `id = auth.uid() or
  -- shares_project_with(id)` (20260709000001) and this function is SECURITY
  -- DEFINER, so a name stored here would outlive the membership that authorised
  -- reading it. Readers resolve it under their own RLS and fall back to
  -- "someone" — which a removed member's name now always will, for everyone.
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    p_project_id, null, auth.uid(), 'member.removed',
    jsonb_build_object(
      'removed_user_id', p_user_id,
      'story_count', v_count,
      'removal_id', v_token,
      -- The reader cannot derive this: it selects the actor's name, not their
      -- id, and after a self-leave neither name resolves anyway.
      'self_leave', auth.uid() is not distinct from p_user_id
    )
  );

  -- Exit guard. Enumerating this function's waits does not terminate — an UPDATE
  -- waits on a tuple lock, an INSERT on a foreign-key row, a trigger on whatever
  -- it calls — so the guard goes after every write rather than after each wait.
  -- Nothing above is durable until commit, so raising here rolls all of it back.
  -- Re-run the bespoke shape, not require_project_role: a caller who just
  -- removed THEMSELVES is legitimately no longer a member.
  v_caller_role := public.project_role(p_project_id);
  if auth.uid() is distinct from p_user_id then
    if v_caller_role is null then
      raise exception 'Not a member of this project';
    end if;
    if v_caller_role <> 'owner' then
      raise exception 'Only project owners can remove other members';
    end if;
  end if;
end;
$$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   log_story_activity -> 20260803010000_log_assignee_changes.sql
--   remove_member      -> 20260728073000_recheck_role_after_lock.sql
-- Rows already written stay readable: the feed filter goes with the reverted
-- app code, so the collapsed rows reappear individually, and member.removed
-- rows fall back to describeActivity's default wording rather than breaking.
-- ============================================================
