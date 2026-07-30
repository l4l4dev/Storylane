-- ============================================================
-- TASK-221: the assignee must be a member of the story's project, enforced by a
-- composite FK instead of by every writer remembering to check.
--
--   stories (project_id, assignee_id) -> project_members (project_id, user_id)
--
-- Until now assignee_id referenced profiles alone and nothing tied it to the
-- project, which 20260722000002 recorded as deliberate under the relaxed stories
-- write model (20260719000002). The cost of that was a removed member staying
-- assigned indefinitely: remove_member clears my_work_story_state and nothing
-- else. `on delete set null (assignee_id)` makes the removal do it, and the
-- engine takes the membership row's KEY SHARE at write time, so no RPC needs a
-- check of its own. There is no in-RPC check left for it to replace either:
-- maintain_story_completed_at's defensive one went with story_completions
-- (20260724000001), and split_story never inherits an assignee.
--
-- Lock order (spec/rls.md "Pin the config a SECURITY DEFINER RPC enforces
-- itself"). This FK creates an ABBA pair that no lock discipline here removes:
-- a story writer holds a stories row and then takes KEY SHARE on the membership
-- row through the FK check, while remove_member holds the membership row
-- exclusively and then updates the referencing stories rows through the cascade.
-- Both halves are taken by the engine, so reordering the SQL cannot separate
-- them. Postgres detects the cycle and aborts one side with 40P01; remove_member
-- is a rare admin action and the loser retries, which is the same class of
-- self-healing outcome deleteProjectState already treats as expected (23503).
-- Rejected: `pg_advisory_xact_lock_shared('membership:' || project)` at the entry
-- of every story RPC. assignee_id is not trigger-guarded and the stories UPDATE
-- policy admits a direct REST PATCH, so a convention that only RPCs follow
-- cannot cover the writes it would need to.
-- ============================================================

-- Before the constraint, not after: without it the cascade's
-- `where project_id = ? and assignee_id = ?` seq-scans stories while
-- remove_member holds the membership row exclusively, which widens the very
-- window the paragraph above accepts as narrow.
create index if not exists stories_project_assignee_idx
  on public.stories (project_id, assignee_id);

-- NOT VALID first, and the cleanup after it. `not valid` skips only the EXISTING
-- rows — it enforces every write from the moment it lands — so this ordering is
-- what closes the window a cleanup-then-validate order leaves open: a
-- remove_member committing between the two statements would find no constraint
-- to cascade through, leave its stories assigned, and the validating ALTER would
-- then abort the whole migration on the row it just created. Correct whether or
-- not the runner wraps this file in a transaction: wrapped, the ALTER's
-- SHARE ROW EXCLUSIVE parks concurrent writers until commit; unwrapped, the
-- constraint is simply live before the scan starts.
--
-- MATCH SIMPLE (the default) skips the check whenever a referencing column is
-- null, so an unassigned story is unconstrained even though project_id is NOT
-- NULL. Column-specific ON DELETE SET NULL matches stories_iteration_project_fkey.
-- stories_assignee_id_fkey -> profiles is left in place: it is implied by this
-- one (a profile delete cascades to project_members, which then lands here), and
-- dropping it buys nothing.
alter table public.stories
  add constraint stories_assignee_project_fkey
  foreign key (project_id, assignee_id)
  references public.project_members (project_id, user_id)
  on delete set null (assignee_id)
  not valid;

-- Rows written before the constraint existed are the only ones left to fix, and
-- VALIDATE below would fail on them. Dropping the assignee is the same answer
-- move/copy already give for a non-member.
--
-- Wrapped only for the count: this discards data, log_story_activity does not
-- record assignee changes, and the local count says nothing about production —
-- so the deploy log is the one place the size of the loss can be seen.
do $$
declare
  v_cleared int;
begin
  update public.stories s
  set assignee_id = null
  where s.assignee_id is not null
    and not exists (
      select 1 from public.project_members m
      where m.project_id = s.project_id and m.user_id = s.assignee_id
    );
  get diagnostics v_cleared = row_count;
  raise notice 'TASK-221: cleared % story assignee(s) who were not members of their project', v_cleared;
end $$;

alter table public.stories validate constraint stories_assignee_project_fkey;

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

  -- The explicit `for share` TASK-219 put here — the one row pinned out of tier
  -- order, because its identity is only known from the locked story read — is
  -- gone: the INSERT below takes the same row's KEY SHARE as part of its own FK
  -- check. The branch stays, and is not something the FK could replace: dropping
  -- a non-member assignee is the normal-case behaviour spec/features.md asks for,
  -- not a race. Only a membership that disappears between this read and the
  -- INSERT is left to the constraint, which raises 23503 instead.
  if v_story.assignee_id is null then
    v_assignee := null;
  else
    perform 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id;
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
  -- rolls all of it back. archived_at and the point scale need no counterpart
  -- here: both rows are pinned, and the assignee's membership is now held by the
  -- INSERT's own FK check.
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

  -- The explicit `for share` TASK-219 put here — the one row pinned out of tier
  -- order, because its identity is only known from the locked story read — is
  -- gone: the INSERT below takes the same row's KEY SHARE as part of its own FK
  -- check. The branch stays, and is not something the FK could replace: dropping
  -- a non-member assignee is the normal-case behaviour spec/features.md asks for,
  -- not a race. Only a membership that disappears between this read and the
  -- INSERT is left to the constraint, which raises 23503 instead.
  if v_story.assignee_id is null then
    v_assignee := null;
  else
    perform 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id;
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
  -- rolls all of it back. archived_at and the point scale need no counterpart
  -- here: both rows are pinned, and the assignee's membership is now held by the
  -- INSERT's own FK check.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;


-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   alter table public.stories drop constraint stories_assignee_project_fkey;
--   drop index if exists public.stories_project_assignee_idx;
-- then restore both function bodies from
-- 20260730020000_pin_rpc_config_with_for_share.sql, which puts the explicit
-- `for share` on the membership row back. The cleanup UPDATE is not reversible —
-- the assignees it cleared are not recorded anywhere.
-- ============================================================
