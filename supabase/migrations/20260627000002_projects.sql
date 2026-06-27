-- ============================================================
-- projects + project_members + access helper functions
-- ============================================================

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  velocity_window  int  not null default 3,
  iteration_length int  not null default 14,
  point_scale      text not null default 'fibonacci'
                     check (point_scale in ('fibonacci', 'linear', 'custom')),
  custom_points    int[],
  created_by       uuid not null default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null check (role in ('owner', 'member', 'viewer')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_id_idx on public.project_members (user_id);

-- SECURITY DEFINER helpers bypass RLS on project_members, avoiding policy recursion.
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

create or replace function public.project_role(p_project_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.project_members
  where project_id = p_project_id and user_id = auth.uid();
$$;

-- When a project is created, register the creator as its owner.
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

-- projects policies
create policy "members can view their projects"
  on public.projects for select to authenticated
  using (public.is_project_member(id));

create policy "authenticated users can create projects"
  on public.projects for insert to authenticated
  with check (created_by = auth.uid());

create policy "owners can update projects"
  on public.projects for update to authenticated
  using (public.project_role(id) = 'owner')
  with check (public.project_role(id) = 'owner');

create policy "owners can delete projects"
  on public.projects for delete to authenticated
  using (public.project_role(id) = 'owner');

-- project_members policies
create policy "members can view project membership"
  on public.project_members for select to authenticated
  using (public.is_project_member(project_id));

create policy "owners can add members"
  on public.project_members for insert to authenticated
  with check (public.project_role(project_id) = 'owner');

create policy "owners can update member roles"
  on public.project_members for update to authenticated
  using (public.project_role(project_id) = 'owner')
  with check (public.project_role(project_id) = 'owner');

create policy "owners can remove members"
  on public.project_members for delete to authenticated
  using (public.project_role(project_id) = 'owner');
