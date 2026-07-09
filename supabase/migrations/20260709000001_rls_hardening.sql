-- ============================================================
-- Pre-deploy RLS hardening (TASK-18, security review 2026-07-08).
-- Advisor-reviewed 2026-07-09.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles SELECT was `using (true)` — any authenticated user could
-- enumerate the whole user directory. Scope to own profile + anyone
-- sharing a project. SECURITY DEFINER to avoid RLS recursion, same
-- shape as is_project_member/project_role.
-- ------------------------------------------------------------
create or replace function public.shares_project_with(p_target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs
      on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_target_user_id
  );
$$;

drop policy "profiles are viewable by authenticated users" on public.profiles;

create policy "profiles are viewable by self or co-members"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.shares_project_with(id));

-- ------------------------------------------------------------
-- 2. comments UPDATE/DELETE only checked author_id, unlike INSERT which
-- also requires current owner/member role via the parent story — a
-- removed/downgraded member could still edit or delete their old
-- comments by id.
-- ------------------------------------------------------------
drop policy "authors can update own comments" on public.comments;

create policy "authors can update own comments"
  on public.comments for update to authenticated
  using (
    author_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
    )
  )
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
    )
  );

drop policy "authors or owners can delete comments" on public.comments;

create policy "authors or owners can delete comments"
  on public.comments for delete to authenticated
  using (
    (
      author_id = auth.uid()
      and exists (
        select 1 from public.stories s
        where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
      )
    )
    or exists (
      select 1 from public.stories s
      where s.id = story_id and public.project_role(s.project_id) = 'owner'
    )
  );

-- ------------------------------------------------------------
-- 3. stories.epic_id / stories.iteration_id were plain FKs — FK checks
-- bypass RLS, so a member of two projects could point a story at
-- another project's epic/iteration. Composite FK on (id, project_id),
-- matching the stories_custom_status_project_fkey precedent
-- (20260707000007). Column-list ON DELETE SET NULL is required here
-- (unlike that precedent): a bare `on delete set null` on a composite FK
-- nulls every referenced column, including project_id, which is NOT
-- NULL on stories — that would block any epic/iteration delete that
-- still has stories attached.
-- ------------------------------------------------------------
alter table public.epics
  add constraint epics_id_project_id_key unique (id, project_id);

alter table public.iterations
  add constraint iterations_id_project_id_key unique (id, project_id);

alter table public.stories drop constraint stories_epic_id_fkey;
alter table public.stories
  add constraint stories_epic_project_fkey
  foreign key (epic_id, project_id)
  references public.epics (id, project_id)
  on delete set null (epic_id);

alter table public.stories drop constraint stories_iteration_id_fkey;
alter table public.stories
  add constraint stories_iteration_project_fkey
  foreign key (iteration_id, project_id)
  references public.iterations (id, project_id)
  on delete set null (iteration_id);

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.stories drop constraint stories_iteration_project_fkey;
-- alter table public.stories
--   add constraint stories_iteration_id_fkey
--   foreign key (iteration_id) references public.iterations (id) on delete set null;
-- alter table public.stories drop constraint stories_epic_project_fkey;
-- alter table public.stories
--   add constraint stories_epic_id_fkey
--   foreign key (epic_id) references public.epics (id) on delete set null;
-- alter table public.iterations drop constraint iterations_id_project_id_key;
-- alter table public.epics drop constraint epics_id_project_id_key;
--
-- drop policy "authors or owners can delete comments" on public.comments;
-- create policy "authors or owners can delete comments"
--   on public.comments for delete to authenticated
--   using (
--     author_id = auth.uid()
--     or exists (
--       select 1 from public.stories s
--       where s.id = story_id and public.project_role(s.project_id) = 'owner'
--     )
--   );
--
-- drop policy "authors can update own comments" on public.comments;
-- create policy "authors can update own comments"
--   on public.comments for update to authenticated
--   using (author_id = auth.uid())
--   with check (author_id = auth.uid());
--
-- drop policy "profiles are viewable by self or co-members" on public.profiles;
-- create policy "profiles are viewable by authenticated users"
--   on public.profiles for select to authenticated using (true);
-- drop function public.shares_project_with(uuid);
