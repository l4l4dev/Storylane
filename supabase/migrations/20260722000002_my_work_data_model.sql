-- ============================================================
-- TASK-130 (doc-14): My Work Kanban rework — data model foundation.
--
-- Additive only. story_pins stays for now: its drop, the two RPCs that
-- reference it, and the TS rewrite that frees it are TASK-131, so main keeps
-- compiling and passing between the two tasks (owner decision 2026-07-22).
--
-- Three new tables + the completion-log trigger + a stories SELECT RLS
-- OR-clause. Incorporates the fable-advisor round-3 fixes (stories RLS OR,
-- SECURITY DEFINER trigger, integrations-style mapping RLS) plus one
-- correctness fix found in implementation (the completion insert is gated to
-- UPDATE — see maintain_story_completed_at below).
-- ============================================================

-- ------------------------------------------------------------
-- my_work_story_state — per-user, per-story My Work marks (doc-14). Folds in
-- story_pins' old boolean pin as `is_today`, but drops its cross-project reach:
-- a row is only meaningful for a story in the user's own base scope
-- (assignee_id = user_id), enforced by the classification + the removed pin
-- affordance (TASK-131), matching story_pins' own-rows RLS character.
-- ------------------------------------------------------------
create table public.my_work_story_state (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  story_id     uuid not null references public.stories(id) on delete cascade,
  is_today     boolean not null default false,
  local_status text check (local_status in ('todo', 'doing', 'done')),
  updated_at   timestamptz not null default now(),
  primary key (user_id, story_id)
);
-- story_id alone is the reverse lookup ("who has this story customized"), used
-- by cascade-adjacent cleanup — matching story_pins' shape.
create index my_work_story_state_story_id_idx on public.my_work_story_state (story_id);

alter table public.my_work_story_state enable row level security;

-- Own rows only; nothing surfaces another user's marks.
create policy "users view their own my_work_story_state"
  on public.my_work_story_state for select to authenticated
  using (user_id = auth.uid());

create policy "users create their own my_work_story_state"
  on public.my_work_story_state for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = my_work_story_state.story_id
        and public.is_project_member(s.project_id)
    )
  );

-- Separate UPDATE policy (unlike story_pins, whose columns were all PK): the
-- write path upserts is_today / local_status on an existing row. The WITH CHECK
-- re-validates project membership for story_id (itself part of the updatable
-- PK) so a row can't be repointed at a story in a project the user isn't in,
-- bypassing the insert-time check.
create policy "users update their own my_work_story_state"
  on public.my_work_story_state for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = my_work_story_state.story_id
        and public.is_project_member(s.project_id)
    )
  );

create policy "users delete their own my_work_story_state"
  on public.my_work_story_state for delete to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- project_my_work_mapping — per-project Doing/Done -> project_states mapping,
-- owner-configured (doc-14). One row per project. `on delete set null` falls a
-- mapping back to unmapped if the mapped state is deleted; a category change is
-- handled read-side (classification treats a category-mismatched mapping as
-- unmapped), per doc-14. RLS mirrors integrations' owner-writes pattern, but
-- SELECT is widened to every member since each member's My Work classification
-- reads the mapping.
-- ------------------------------------------------------------
create table public.project_my_work_mapping (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  doing_state_id uuid references public.project_states(id) on delete set null,
  done_state_id  uuid references public.project_states(id) on delete set null,
  configured_by  uuid references public.profiles(id),
  updated_at     timestamptz not null default now()
);

alter table public.project_my_work_mapping enable row level security;

create policy "members view project_my_work_mapping"
  on public.project_my_work_mapping for select to authenticated
  using (public.is_project_member(project_id));

create policy "owners create project_my_work_mapping"
  on public.project_my_work_mapping for insert to authenticated
  with check (public.project_role(project_id) = 'owner');

create policy "owners update project_my_work_mapping"
  on public.project_my_work_mapping for update to authenticated
  using (public.project_role(project_id) = 'owner')
  with check (public.project_role(project_id) = 'owner');

create policy "owners delete project_my_work_mapping"
  on public.project_my_work_mapping for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- ------------------------------------------------------------
-- story_completions — append-only personal completion log (doc-14). One row
-- each time a story enters a done-category state, credited to its assignee.
-- Never updated or deleted: reopening/redoing adds a NEW row. Drives My Work's
-- Done column, which must survive the completer leaving the project.
-- ------------------------------------------------------------
create table public.story_completions (
  id           uuid primary key default gen_random_uuid(),
  story_id     uuid not null references public.stories(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  completed_at timestamptz not null default now()
);
-- The Done log's query shape: the viewer's completions, most recent first.
create index story_completions_user_completed_idx
  on public.story_completions (user_id, completed_at desc);

alter table public.story_completions enable row level security;

create policy "users view their own story_completions"
  on public.story_completions for select to authenticated
  using (user_id = auth.uid());

-- No client insert/update/delete policy at all: only the
-- maintain_story_completed_at SECURITY DEFINER trigger writes this (the
-- TASK-110 iterations-lockdown pattern). Revoke the default grants too as
-- defense-in-depth — a missing policy already denies, and now a future
-- re-grant still can't open a client write path.
revoke insert, update, delete on public.story_completions from authenticated;

-- ------------------------------------------------------------
-- maintain_story_completed_at — full replacement (this function's established
-- pattern across its prior redefinitions), now SECURITY DEFINER and logging a
-- story_completions row when a story transitions INTO a done category.
--
-- SECURITY DEFINER: story_completions has no client INSERT policy, so an
-- invoker-rights insert would fail for EVERY done transition (a project's own
-- board as well as My Work), not just a My Work edge case.
--
-- The insert is gated to tg_op = 'UPDATE': a BEFORE INSERT trigger cannot
-- create an FK child of the not-yet-inserted story, and a story born into a
-- done state isn't a user "completion" (there's no non-done state it came
-- from). Guarded by new.assignee_id is not null: an unassigned story reaching
-- done has nobody to credit and story_completions.user_id is NOT NULL.
-- ------------------------------------------------------------
create or replace function public.maintain_story_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_category text;
  v_new_category text;
begin
  if tg_op = 'UPDATE' and new.state_id is not distinct from old.state_id then
    new.completed_at := old.completed_at;
    return new;
  end if;

  if new.state_id is not null then
    select category into v_new_category from public.project_states where id = new.state_id;
  end if;

  if tg_op = 'UPDATE' and old.state_id is not null then
    select category into v_old_category from public.project_states where id = old.state_id;
  end if;

  if v_new_category = 'done' then
    if v_old_category = 'done' then
      new.completed_at := old.completed_at; -- done-to-done: preserve
    else
      new.completed_at := now();
      -- Append-only personal completion log (doc-14). Credit the assignee (not
      -- the actor: a PM may finish a story on someone else's behalf), skip when
      -- there's no assignee. The assignee must be a current project member:
      -- any member can set assignee_id to an arbitrary profile and move a story
      -- to done (the relaxed stories write model, 20260719000002), and a
      -- forged completion row would grant that outsider permanent read access
      -- to the story via stories' SELECT OR-clause below. Membership is checked
      -- HERE (at completion), not at read time, so a legitimate completer who
      -- later leaves the project still keeps their Done entry.
      if tg_op = 'UPDATE' and new.assignee_id is not null
         and exists (
           select 1 from public.project_members pm
           where pm.project_id = new.project_id and pm.user_id = new.assignee_id
         ) then
        insert into public.story_completions (story_id, user_id)
        values (new.id, new.assignee_id);
      end if;
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- stories SELECT RLS — add an OR clause so a story's own row stays readable to
-- anyone with a story_completions entry for it, even after they leave the
-- project (doc-14: the Done log live-joins to the story's current data). The
-- clause short-circuits behind is_project_member, so the subquery only runs
-- for the rare left-the-project-but-completed-it case.
-- ------------------------------------------------------------
drop policy "members can view stories" on public.stories;
create policy "members can view stories"
  on public.stories for select to authenticated
  using (
    public.is_project_member(project_id)
    or exists (
      select 1 from public.story_completions sc
      where sc.story_id = stories.id and sc.user_id = auth.uid()
    )
  );

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop policy "members can view stories" on public.stories;
-- create policy "members can view stories" on public.stories for select to authenticated
--   using (public.is_project_member(project_id));
-- (restore maintain_story_completed_at from 20260719000008 — SECURITY INVOKER, no completions insert)
-- drop table public.story_completions;
-- drop table public.project_my_work_mapping;
-- drop table public.my_work_story_state;
