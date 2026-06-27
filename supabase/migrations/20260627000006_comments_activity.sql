-- ============================================================
-- comments + activity_logs
-- ============================================================

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references public.stories (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id),
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_story_id_idx on public.comments (story_id);

create table public.activity_logs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  story_id   uuid references public.stories (id) on delete set null,
  actor_id   uuid not null default auth.uid() references public.profiles (id),
  action     text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_project_id_idx on public.activity_logs (project_id);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

alter table public.comments enable row level security;
alter table public.activity_logs enable row level security;

-- comments: members read; members/owners create (as themselves);
-- authors update own; authors or project owners delete.
create policy "members can view comments"
  on public.comments for select to authenticated
  using (exists (
    select 1 from public.stories s
    where s.id = story_id and public.is_project_member(s.project_id)
  ));

create policy "members can add comments"
  on public.comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
    )
  );

create policy "authors can update own comments"
  on public.comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "authors or owners can delete comments"
  on public.comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_id and public.project_role(s.project_id) = 'owner'
    )
  );

-- activity_logs: members read; members/owners append as themselves. Immutable (no update/delete).
create policy "members can view activity"
  on public.activity_logs for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can write activity"
  on public.activity_logs for insert to authenticated
  with check (
    actor_id = auth.uid()
    and public.project_role(project_id) in ('owner', 'member')
  );
