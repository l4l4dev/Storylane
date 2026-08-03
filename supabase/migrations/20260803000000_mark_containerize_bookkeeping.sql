-- ============================================================
-- Turning a story into an epic is one user action that writes four
-- activity_logs rows. recompute_is_container records story.containerized (the
-- only place the lost points survive) and then clears points, state_id and
-- iteration_id in a single UPDATE — which log_story_activity faithfully splits
-- into story.state_changed, story.iteration_changed and story.points_changed.
--
-- The project feed renders every row, so one click reads as four events; and
-- the Slack outbox fires on any story.state_changed, so a Slack-connected
-- project announces "moved to the Icebox" (slack-notify maps a null `to` to
-- the Icebox) every time someone creates an epic.
--
-- The three rows are NOT suppressed. buildBurndown rewinds from a story's
-- current row, and for an epic that row has points/state_id/iteration_id all
-- NULL — those transitions are exactly how the replay learns the story held N
-- points and sat in the iteration until this moment. Dropping them would make
-- a containerized story read as never having been a member. They are also true
-- statements about columns that really changed, which is what an audit log is
-- for. So they are MARKED instead, and each reader decides.
--
-- Readers after this migration:
--   buildBurndown        — ignores the marker, replays as before
--   project activity feed — hides marked rows; story.containerized says it
--   story detail history  — same
--   MCP get_story         — same, and before its limit(10) so the marked rows
--                           cannot evict real history from an agent's window
--   Slack outbox          — skips marked rows in its trigger WHEN clause
--
-- A separate GUC from storylane.rollover (20260731000000) rather than more
-- values on one key: nothing composes a rollover and a containerize in one
-- transaction today, but sharing a key would silently make one clobber the
-- other the first time something does. Read with the same discipline that
-- migration documents — text only, never cast, missing_ok, nullif on the empty
-- string an is_local GUC reverts to.
--
-- Rows written before this are NOT backfilled, so an epic created earlier
-- still reads as four events. Identifying them after the fact means pairing
-- each story.containerized with whatever landed near it in time, which is a
-- guess — and one that would mislabel a genuine state change made in the same
-- second. Old feed noise is the cheaper wrong.
-- ============================================================

-- Verbatim from 20260724181957_epic_pinned.sql except the two set_config calls
-- around the false -> true UPDATE. The true -> false branch is deliberately
-- untouched: it writes only is_container, which no watcher looks at, so it
-- produces none of the rows this marker exists to label.
create or replace function public.recompute_is_container(p_parent uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       public.stories%rowtype;
  v_should_be boolean;
begin
  if p_parent is null then
    return;
  end if;

  select * into v_row from public.stories where id = p_parent for update;
  if not found then
    return; -- parent already deleted (its children's parent_id SET NULL first)
  end if;

  v_should_be := v_row.epic_pinned
    or exists (select 1 from public.stories where parent_id = p_parent);

  if v_should_be and not v_row.is_container then
    -- false -> true. Audit the points that are about to be lost (the only place
    -- the value survives — doc-18 §4). state_id/iteration_id are cleared in the
    -- same statement so the off-board CHECK holds; completed_at is cleared for
    -- free by maintain_story_completed_at (BEFORE UPDATE) since state_id goes
    -- NULL.
    -- Unconditional, unlike its predecessor which skipped an unestimated
    -- story: the three rows below are hidden on the understanding that this
    -- one speaks for them, and an unestimated story with a state still
    -- produces them — so skipping it left that case with no trace anywhere.
    -- old_points is simply null when there was no estimate to lose. actor_id
    -- coalesces like log_story_activity's does, since it is NOT NULL and being
    -- unconditional now exposes every caller without an auth.uid() to it.
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      v_row.project_id, v_row.id, coalesce(auth.uid(), v_row.created_by), 'story.containerized',
      jsonb_build_object('old_points', v_row.points)
    );
    -- Set here rather than in the callers: this function is reached from the
    -- maintain_is_container trigger on several paths (split_story's child
    -- inserts, a parent_id edit, an epic_pinned toggle), and a marker each
    -- caller has to remember is one that eventually gets forgotten.
    perform set_config('storylane.bookkeeping', 'containerize', true);
    update public.stories
      set is_container = true, points = null, state_id = null, iteration_id = null,
          epic_color = coalesce(epic_color, '#6366f1')
      where id = p_parent;
    perform set_config('storylane.bookkeeping', '', true);
  elsif not v_should_be and v_row.is_container then
    update public.stories set is_container = false where id = p_parent;
  end if;
end;
$$;

-- Verbatim from 20260731000000 except the bookkeeping key on the three watched
-- transitions. story.created and story.containerized do not carry it — they are
-- the rows that survive, not the ones being labelled.
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

  return new;
end;
$$;

-- set_epic_pinned is the OTHER way a story becomes an epic — the "Turn into
-- epic" action, which never routes through recompute_is_container because
-- stories_maintain_is_container only fires on parent_id writes and this one
-- touches epic_pinned. It carries its own copy of the audit-then-clear, so it
-- needs the same corrections or the user-facing path stays unfixed.
--
-- Verbatim from 20260728140000_story_rpc_exit_guards.sql — the CURRENT body,
-- which added the post-write role re-check — apart from those.
create or replace function public.set_epic_pinned(p_story_id uuid, p_pinned boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.stories%rowtype;
begin
  -- NULL would slip past the idempotence comparison below (NULL = anything is
  -- NULL, not true) and land in the unpin branch.
  if p_pinned is null then
    raise exception 'p_pinned is required' using errcode = 'P0001';
  end if;

  select * into v_row from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role in ('owner', 'member')
      )
    for update;
  if not found then
    raise exception 'Story not found' using errcode = 'P0001';
  end if;

  if (select is_personal from public.projects where id = v_row.project_id) then
    raise exception 'Personal tasks cannot be organised into epics' using errcode = 'P0001';
  end if;

  -- Ahead of the idempotence return: a container that is one only through child
  -- membership has epic_pinned = false already, and answering "done" to
  -- "stop being an epic" while the row stays an epic is a lie.
  if not p_pinned and exists (select 1 from public.stories where parent_id = p_story_id) then
    raise exception 'This epic still has stories in it — move them out first' using errcode = 'P0001';
  end if;

  if v_row.epic_pinned = p_pinned then
    return; -- idempotent
  end if;

  if p_pinned then
    -- A child cannot gain children, so it cannot be an epic either
    -- (single-level nesting, doc-18 §3).
    if v_row.parent_id is not null then
      raise exception 'A child story cannot become an epic (single-level nesting)' using errcode = 'P0001';
    end if;
    -- Coalesced actor_id and guarded on is_container, matching
    -- recompute_is_container above; the three rows the UPDATE below produces
    -- are hidden from the feeds on the understanding that this one speaks for
    -- them. A story that is a container through child membership is already an
    -- epic here (epic_pinned false, is_container true, board fields NULL), and
    -- the UPDATE only flips epic_pinned — so an unguarded insert would render
    -- a second "turned X into an epic" with nothing to speak for.
    if not v_row.is_container then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        v_row.project_id, v_row.id, coalesce(auth.uid(), v_row.created_by), 'story.containerized',
        jsonb_build_object('old_points', v_row.points)
      );
    end if;
    perform set_config('storylane.bookkeeping', 'containerize', true);
    update public.stories
      set epic_pinned = true, points = null, state_id = null, iteration_id = null,
          epic_color = coalesce(epic_color, '#6366f1')
      where id = p_story_id;
    perform set_config('storylane.bookkeeping', '', true);
  else
    -- Board fields stay NULL (doc-18 §4): the story can be re-estimated and
    -- placed normally afterwards.
    update public.stories set epic_pinned = false where id = p_story_id;
  end if;

  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"): the
  -- writes above can each wait on a tuple lock, a foreign key, or a trigger
  -- (assign_story_number parks here), all of which are past the authorization
  -- this function performed. Nothing is durable until commit, so raising here
  -- rolls the writes back.
  perform public.require_project_role(v_row.project_id, 'owner', 'member');
end;
$function$;

-- Recreated rather than replaced: a trigger's WHEN clause cannot be altered in
-- place. Everything else is verbatim from 20260721000003.
drop trigger if exists activity_logs_slack_notify on public.activity_logs;
create trigger activity_logs_slack_notify
  after insert on public.activity_logs
  for each row
  when (new.action = 'story.state_changed' and new.payload->>'bookkeeping' is null)
  execute function public.trg_slack_notify('story_state_changed');

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   recompute_is_container -> 20260724181957_epic_pinned.sql
--   log_story_activity     -> 20260731000000_log_story_points_and_rollover_marker.sql
--   set_epic_pinned        -> 20260728140000_story_rpc_exit_guards.sql
--                             (NOT 20260724181957, which predates the exit
--                              guard TASK-223 added — restoring that one
--                              would silently drop the post-write role check)
--   activity_logs_slack_notify -> 20260721000003_slack_notifications_outbox.sql
-- Rows already carrying 'bookkeeping' stay readable: every reader treats the
-- key as optional, so reverting only stops new rows being labelled.
-- ============================================================
