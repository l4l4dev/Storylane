-- ============================================================
-- integrations (contains provider secrets/tokens — owner-only)
-- ============================================================

create table public.integrations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  provider   text not null check (provider in ('github', 'slack', 'forgejo')),
  config     jsonb not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index integrations_project_id_idx on public.integrations (project_id);

alter table public.integrations enable row level security;

-- Only project owners may see or manage integrations (config holds secrets).
create policy "owners can view integrations"
  on public.integrations for select to authenticated
  using (public.project_role(project_id) = 'owner');

create policy "owners can create integrations"
  on public.integrations for insert to authenticated
  with check (public.project_role(project_id) = 'owner');

create policy "owners can update integrations"
  on public.integrations for update to authenticated
  using (public.project_role(project_id) = 'owner')
  with check (public.project_role(project_id) = 'owner');

create policy "owners can delete integrations"
  on public.integrations for delete to authenticated
  using (public.project_role(project_id) = 'owner');
