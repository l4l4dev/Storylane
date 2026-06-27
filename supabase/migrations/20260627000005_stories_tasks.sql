-- ============================================================
-- stories + tasks + story_labels
-- (story_labels lives here because it depends on stories)
-- ============================================================

create table public.stories (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  iteration_id uuid references public.iterations (id) on delete set null,
  epic_id      uuid references public.epics (id) on delete set null,
  title        text not null,
  description  text,
  story_type   text not null default 'feature'
                 check (story_type in ('feature', 'bug', 'chore', 'release')),
  state        text not null default 'unstarted'
                 check (state in ('unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected')),
  points       int check (points >= 0),
  position     int  not null default 0,
  assignee_id  uuid references public.profiles (id) on delete set null,
  created_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index stories_project_id_idx   on public.stories (project_id);
create index stories_iteration_id_idx on public.stories (iteration_id);
create index stories_epic_id_idx      on public.stories (epic_id);

create table public.tasks (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references public.stories (id) on delete cascade,
  title      text not null,
  is_done    boolean not null default false,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index tasks_story_id_idx on public.tasks (story_id);

create table public.story_labels (
  story_id uuid not null references public.stories (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (story_id, label_id)
);

create trigger stories_set_updated_at
  before update on public.stories
  for each row execute function public.set_updated_at();

alter table public.stories enable row level security;
alter table public.tasks enable row level security;
alter table public.story_labels enable row level security;

-- stories: members read; owner/member create; owner OR author/assignee update; owner delete.
create policy "members can view stories"
  on public.stories for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create stories"
  on public.stories for insert to authenticated
  with check (
    public.project_role(project_id) in ('owner', 'member')
    and created_by = auth.uid()
  );

create policy "owners or authors can update stories"
  on public.stories for update to authenticated
  using (
    public.project_role(project_id) = 'owner'
    or (
      public.project_role(project_id) = 'member'
      and (created_by = auth.uid() or assignee_id = auth.uid())
    )
  )
  with check (
    public.project_role(project_id) = 'owner'
    or (
      public.project_role(project_id) = 'member'
      and (created_by = auth.uid() or assignee_id = auth.uid())
    )
  );

create policy "owners can delete stories"
  on public.stories for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- tasks: scoped through the parent story's project.
create policy "members can view tasks"
  on public.tasks for select to authenticated
  using (exists (
    select 1 from public.stories s
    where s.id = story_id and public.is_project_member(s.project_id)
  ));

create policy "members can create tasks"
  on public.tasks for insert to authenticated
  with check (exists (
    select 1 from public.stories s
    where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
  ));

create policy "members can update tasks"
  on public.tasks for update to authenticated
  using (exists (
    select 1 from public.stories s
    where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
  ))
  with check (exists (
    select 1 from public.stories s
    where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
  ));

create policy "members can delete tasks"
  on public.tasks for delete to authenticated
  using (exists (
    select 1 from public.stories s
    where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
  ));

-- story_labels: scoped through the parent story's project.
create policy "members can view story_labels"
  on public.story_labels for select to authenticated
  using (exists (
    select 1 from public.stories s
    where s.id = story_id and public.is_project_member(s.project_id)
  ));

create policy "members can add story_labels"
  on public.story_labels for insert to authenticated
  with check (exists (
    select 1 from public.stories s
    where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
  ));

create policy "members can remove story_labels"
  on public.story_labels for delete to authenticated
  using (exists (
    select 1 from public.stories s
    where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
  ));
