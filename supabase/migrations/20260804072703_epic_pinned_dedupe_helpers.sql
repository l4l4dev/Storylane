-- ============================================================
-- doc-20 §2 / doc-18 §4: the epic_pinned surface had three literals and one
-- block hand-copied across four function bodies. Each copy is a place a later
-- fix can miss — 20260803000000 already had to apply the same correction twice
-- in one migration because set_epic_pinned carries its own copy of
-- recompute_is_container's audit-then-clear.
--
-- Three helpers below own what was duplicated. The four callers are recreated
-- from their CURRENT bodies (see the DOWN block for each one's source) with
-- only the duplicated parts swapped out.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The epic colour default.
--
-- apps/web/lib/utils/epics-list.ts keeps its own DEFAULT_EPIC_COLOR for the
-- display fallback; this is the writer's copy, and the DB is authoritative.
-- ------------------------------------------------------------
create or replace function public.default_epic_color()
returns text
language sql
immutable
as $$
  select '#6366f1'::text;
$$;

revoke execute on function public.default_epic_color() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. The is_container formula.
--
-- p_epic_pinned is a parameter rather than a read of the row: derive_is_container
-- calls this from a BEFORE trigger with NEW.epic_pinned, a value not yet in the
-- table. stable, not immutable — it reads stories.
-- ------------------------------------------------------------
create or replace function public.story_should_be_container(p_story_id uuid, p_epic_pinned boolean)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_epic_pinned
    or exists (select 1 from public.stories where parent_id = p_story_id);
$$;

revoke execute on function public.story_should_be_container(uuid, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. The audit-then-clear a story undergoes when it becomes a container.
--
-- Both callers guard on the same condition (recompute_is_container reaches its
-- copy only inside `v_should_be and not v_row.is_container`), so the audit row
-- is written iff the story was not already a container.
--
-- NOT security definer, unlike its two callers: this clears any story's points,
-- state and iteration with no authorization check of its own, so making it
-- definer would leave the revoke below as the only thing standing between a
-- client and that. Both callers are already definer, so it runs as the owner
-- there regardless.
-- ------------------------------------------------------------
create or replace function public.containerize_story(p_row public.stories, p_pin boolean)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not p_row.is_container then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      p_row.project_id, p_row.id, coalesce(auth.uid(), p_row.created_by), 'story.containerized',
      jsonb_build_object('old_points', p_row.points)
    );
  end if;
  -- set and reset must both live here: storylane.bookkeeping is txn-local, and a
  -- missed reset labels the rest of the transaction's writes as bookkeeping —
  -- which is what the Slack outbox trigger's WHEN clause and the feed filter
  -- both key off.
  perform set_config('storylane.bookkeeping', 'containerize', true);
  update public.stories
    -- epic_pinned is in the SET list even when p_pin is false (the value does not
    -- change): a future `update of epic_pinned` trigger would therefore fire on
    -- the child-membership path too, since that clause reads the SET list, not
    -- the value.
    set is_container = true, epic_pinned = epic_pinned or p_pin,
        points = null, state_id = null, iteration_id = null,
        epic_color = coalesce(epic_color, public.default_epic_color())
    where id = p_row.id;
  perform set_config('storylane.bookkeeping', '', true);
end;
$$;

revoke execute on function public.containerize_story(public.stories, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. The four callers.
-- ------------------------------------------------------------
create or replace function public.derive_is_container()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_container := public.story_should_be_container(new.id, new.epic_pinned);
  return new;
end;
$$;

revoke execute on function public.derive_is_container() from public, anon, authenticated;

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

  v_should_be := public.story_should_be_container(p_parent, v_row.epic_pinned);

  if v_should_be and not v_row.is_container then
    perform public.containerize_story(v_row, false);
  elsif not v_should_be and v_row.is_container then
    update public.stories set is_container = false where id = p_parent;
  end if;
end;
$$;

create or replace function public.set_epic_pinned(p_story_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    perform public.containerize_story(v_row, true);
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
$$;

create or replace function public.create_epic(
  p_project_id  uuid,
  p_title       text,
  p_description text default null,
  p_epic_color  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_title is null or btrim(p_title) = '' then
    raise exception 'An epic needs a title' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role in ('owner', 'member')
  ) then
    raise exception 'Project not found' using errcode = 'P0001';
  end if;

  -- The personal project's creator is always its sole owner, so the membership
  -- check above does not keep epics out of My Work.
  if (select is_personal from public.projects where id = p_project_id) then
    raise exception 'Personal tasks cannot be organised into epics' using errcode = 'P0001';
  end if;

  -- points/state_id/iteration_id stay NULL: is_container flips true on insert
  -- (epic_pinned), and the off-board CHECK requires exactly that.
  insert into public.stories (project_id, title, description, story_type, epic_color, epic_pinned, created_by)
  -- nullif: an empty/blank colour is as colourless as NULL.
  values (p_project_id, btrim(p_title), p_description, 'feature',
          coalesce(nullif(btrim(p_epic_color), ''), public.default_epic_color()), true, auth.uid())
  returning id into v_id;

  -- Exit guard, as in set_epic_pinned above.
  perform public.require_project_role(p_project_id, 'owner', 'member');

  return v_id;
end;
$$;

revoke execute on function public.create_epic(uuid, text, text, text) from public, anon;
grant execute on function public.create_epic(uuid, text, text, text) to authenticated;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting).
-- The bodies come back BEFORE the helpers go, or the drops leave four live
-- functions calling functions that no longer exist:
--   1. restore, in any order:
--        derive_is_container    -> 20260724181957_epic_pinned.sql
--        recompute_is_container -> 20260803000000_mark_containerize_bookkeeping.sql
--        set_epic_pinned        -> 20260803000000_mark_containerize_bookkeeping.sql
--                                  (NOT 20260724181957, which predates the exit
--                                   guard TASK-223 added)
--        create_epic            -> 20260728140000_story_rpc_exit_guards.sql
--   2. then:
--        drop function public.containerize_story(public.stories, boolean);
--        drop function public.story_should_be_container(uuid, boolean);
--        drop function public.default_epic_color();
-- ============================================================
