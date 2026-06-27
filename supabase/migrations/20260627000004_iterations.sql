-- ============================================================
-- iterations
-- ============================================================

create table public.iterations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  number     int  not null,
  goal       text,
  start_date date not null,
  end_date   date not null,
  velocity   int,
  state      text not null default 'planned'
               check (state in ('planned', 'active', 'done')),
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
create index iterations_project_id_idx on public.iterations (project_id);

alter table public.iterations enable row level security;

create policy "members can view iterations"
  on public.iterations for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create iterations"
  on public.iterations for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update iterations"
  on public.iterations for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete iterations"
  on public.iterations for delete to authenticated
  using (public.project_role(project_id) = 'owner');
