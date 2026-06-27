-- ============================================================
-- epics + labels
-- ============================================================

create table public.epics (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  description text,
  color       text not null default '#6366f1',
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index epics_project_id_idx on public.epics (project_id);

create table public.labels (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null,
  color      text not null default '#6b7280',
  created_at timestamptz not null default now()
);
create index labels_project_id_idx on public.labels (project_id);

create trigger epics_set_updated_at
  before update on public.epics
  for each row execute function public.set_updated_at();

alter table public.epics enable row level security;
alter table public.labels enable row level security;

-- epics: members read; owner/member write; owner-only delete.
create policy "members can view epics"
  on public.epics for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create epics"
  on public.epics for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update epics"
  on public.epics for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete epics"
  on public.epics for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- labels: same access pattern.
create policy "members can view labels"
  on public.labels for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create labels"
  on public.labels for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update labels"
  on public.labels for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete labels"
  on public.labels for delete to authenticated
  using (public.project_role(project_id) = 'owner');
