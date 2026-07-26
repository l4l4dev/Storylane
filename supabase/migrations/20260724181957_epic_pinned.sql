-- ============================================================
-- TASK-189 / doc-20 §2: an epic can exist before (and after) its children.
--
-- doc-18 §4 derived is_container purely from child membership, so an epic could
-- only be created bottom-up (split a story, or point a child at it) and
-- evaporated the moment it lost its last child. doc-20 adds the missing intent:
-- `epic_pinned`, an explicit "this story is an epic" flag, with
--   is_container = has_children OR epic_pinned
-- still derived by the trigger — never written by a client.
--
-- Relaxing derive_is_container instead would reopen TASK-182's HIGH finding
-- (stories has an unconditional member UPDATE policy and a column-less UPDATE
-- grant, so a raw PATCH could un-containerize a real epic and route around the
-- off-board CHECK). epic_pinned therefore gets the same treatment as the flag
-- it feeds: clients cannot write it; the two RPCs below can, because
-- SECURITY DEFINER makes current_user the function owner.
-- ============================================================

alter table public.stories
  add column epic_pinned boolean not null default false;

comment on column public.stories.epic_pinned is
  'doc-20 §2: explicit "is an epic" intent. Feeds is_container (= has_children OR epic_pinned). Writable only through create_epic / set_epic_pinned.';

-- ------------------------------------------------------------
-- 1. is_container gains the pinned term (replaces 20260724075153's body).
-- ------------------------------------------------------------
create or replace function public.derive_is_container()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_container := new.epic_pinned
    or exists (select 1 from public.stories where parent_id = new.id);
  return new;
end;
$$;

revoke execute on function public.derive_is_container() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. epic_pinned is not client-writable.
--
-- Pinning containerizes a story (points/state/iteration cleared, off the
-- board), so a forged PATCH would let any member sweep another member's
-- estimated story off the board in one request. The RPCs below are the only
-- writers: inside a SECURITY DEFINER function current_user is the function
-- owner, so this guard sees `postgres`, not `authenticated`, and steps aside.
-- Allowlisting the client roles (rather than denying a list) keeps service_role
-- and migrations working.
--
-- Why not pin-to-OLD like protect_projects_is_personal (20260721000004): that
-- shape has no legitimate write path at all. epic_pinned needs one.
--
-- The exemption is role-based, so it covers EVERY SECURITY DEFINER function,
-- not just the two below: a later one that writes stories.epic_pinned — e.g.
-- through an `insert ... select` that carries the column along — would skip
-- the ownership, nesting and audit checks set_epic_pinned performs. Route
-- epic_pinned writes through set_epic_pinned.
-- ------------------------------------------------------------
create or replace function public.protect_stories_epic_pinned()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.epic_pinned := false;
  else
    new.epic_pinned := old.epic_pinned;
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_stories_epic_pinned() from public, anon, authenticated;

-- Postgres fires BEFORE ROW triggers in trigger-name order, and the derived
-- flag must read the guarded value — hence the name sorting ahead of
-- stories_derive_is_container.
create trigger stories_aa_protect_epic_pinned
  before insert or update on public.stories
  for each row execute function public.protect_stories_epic_pinned();

-- ------------------------------------------------------------
-- 3. The child-membership recompute learns about pinning (replaces the body last
--    set in 20260724121514, epic_color default included): a pinned story keeps
--    is_container when its last child leaves, instead of silently reverting to
--    a plain story.
-- ------------------------------------------------------------
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
    if v_row.points is not null then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        v_row.project_id, v_row.id, auth.uid(), 'story.containerized',
        jsonb_build_object('old_points', v_row.points)
      );
    end if;
    update public.stories
      set is_container = true, points = null, state_id = null, iteration_id = null,
          epic_color = coalesce(epic_color, '#6366f1')
      where id = p_parent;
  elsif not v_should_be and v_row.is_container then
    update public.stories set is_container = false where id = p_parent;
  end if;
end;
$$;

revoke execute on function public.recompute_is_container(uuid) from public, authenticated;

-- ------------------------------------------------------------
-- 3b. An epic can no longer be nested.
--
-- The symmetric guard in 20260724054954 rejects a story that HAS CHILDREN from
-- becoming a child. Now that is_container can also come from epic_pinned, a
-- pinned CHILDLESS epic slipped through it: update_story / move_story_board
-- both delegate hierarchy legality to this trigger, so a member could nest an
-- epic under an epic — /epics would then list the row both as its own epic and
-- as a child, and the outer epic could never be unpinned ("still has stories").
--
-- create-or-replace of 20260724054954's body, verbatim except the new check.
-- ------------------------------------------------------------
create or replace function public.enforce_single_level_nesting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_project uuid;
  v_parent_parent  uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a story cannot be its own parent';
  end if;

  select project_id, parent_id into v_parent_project, v_parent_parent
  from public.stories where id = new.parent_id;

  -- parent_id is a single-column FK (ON DELETE SET NULL, doc-18 §2) — it carries
  -- no project guard, so a cross-project parent must be rejected here.
  if v_parent_project is distinct from new.project_id then
    raise exception 'parent story must be in the same project';
  end if;

  -- Max depth 1: the intended parent must not itself be a child.
  if v_parent_parent is not null then
    raise exception 'cannot nest under a story that is itself a child (max depth = 1)';
  end if;

  -- Symmetric guard: a story that already has children cannot become a child.
  if exists (select 1 from public.stories where parent_id = new.id) then
    raise exception 'a story with children cannot become a child itself';
  end if;

  -- ...nor can a childless epic (doc-20 §2). Reads the guarded value: this
  -- trigger's name sorts after stories_aa_protect_epic_pinned.
  if new.epic_pinned then
    raise exception 'an epic cannot be nested under another story (unpin it first)';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_single_level_nesting() from public, authenticated;

-- ------------------------------------------------------------
-- 4. create_epic — the "+ Add Epic" path (doc-20 §3).
--
-- A plain INSERT cannot express this: the guard above forces epic_pinned =
-- false for client roles, so a childless epic would come back an ordinary
-- story. position is omitted (default nextval appends at the sequence frontier
-- — position invariant rule 1, same as split_story's child inserts).
-- ------------------------------------------------------------
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
  -- check above does not keep epics out of My Work (TASK-147's pattern).
  if (select is_personal from public.projects where id = p_project_id) then
    raise exception 'Personal tasks cannot be organised into epics' using errcode = 'P0001';
  end if;

  -- points/state_id/iteration_id stay NULL: is_container flips true on insert
  -- (epic_pinned), and the off-board CHECK requires exactly that.
  insert into public.stories (project_id, title, description, story_type, epic_color, epic_pinned, created_by)
  -- nullif: an empty/blank colour is as colourless as NULL (TASK-183).
  values (p_project_id, btrim(p_title), p_description, 'feature',
          coalesce(nullif(btrim(p_epic_color), ''), '#6366f1'), true, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_epic(uuid, text, text, text) from public, anon;
grant execute on function public.create_epic(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 5. set_epic_pinned — "make this story an epic" / "stop being an epic".
--
-- The pinning branch repeats recompute_is_container's audit-then-clear instead
-- of calling it: the pin UPDATE itself flips is_container through the derive
-- trigger, so the off-board CHECK would reject that statement before any AFTER
-- trigger could clear the board fields. Both must land in one statement.
-- ------------------------------------------------------------
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
    if v_row.points is not null then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        v_row.project_id, v_row.id, auth.uid(), 'story.containerized',
        jsonb_build_object('old_points', v_row.points)
      );
    end if;
    update public.stories
      set epic_pinned = true, points = null, state_id = null, iteration_id = null,
          epic_color = coalesce(epic_color, '#6366f1')
      where id = p_story_id;
  else
    -- Board fields stay NULL (doc-18 §4): the story can be re-estimated and
    -- placed normally afterwards.
    update public.stories set epic_pinned = false where id = p_story_id;
  end if;
end;
$$;

revoke execute on function public.set_epic_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_epic_pinned(uuid, boolean) to authenticated;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.set_epic_pinned(uuid, boolean);
-- drop function public.create_epic(uuid, text, text, text);
-- drop trigger stories_aa_protect_epic_pinned on public.stories;
-- drop function public.protect_stories_epic_pinned();
-- alter table public.stories drop column epic_pinned;
-- -- then re-apply the LATEST prior bodies, dropping the epic_pinned term:
-- --   recompute_is_container        -> 20260724121514 (keeps TASK-183's
-- --                                    epic_color default; 20260724054954's
-- --                                    older body would silently revert it)
-- --   derive_is_container           -> 20260724075153
-- --   enforce_single_level_nesting  -> 20260724054954
-- ============================================================
