-- ============================================================
-- TASK-16.3: Free mode swimlanes (KanbanFlow parity, spec/screens.md
-- "Swimlanes", spec/data-model.md "swimlanes").
--
-- Optional horizontal lanes for free-mode boards. When a project has
-- swimlane rows, the board renders lanes x columns plus a "No lane" band
-- for unassigned stories, shown first. Same pattern as custom_statuses
-- (Task 14): composite FK, no ON DELETE action, so a lane with stories on
-- it can't be deleted (the app surfaces the 23503 error and the owner
-- moves the cards first).
-- ============================================================

create table public.swimlanes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index swimlanes_project_id_idx on public.swimlanes (project_id);

-- Composite FK (not a plain id reference) so a story can only ever point
-- at a lane of its own project — a tampered client could otherwise set
-- another project's lane UUID, since FK existence checks don't go
-- through RLS.
alter table public.swimlanes
  add constraint swimlanes_id_project_id_key unique (id, project_id);

alter table public.stories add column swimlane_id uuid;
alter table public.stories
  add constraint stories_swimlane_project_fkey
  foreign key (swimlane_id, project_id)
  references public.swimlanes (id, project_id);
create index stories_swimlane_id_idx on public.stories (swimlane_id);

alter table public.swimlanes enable row level security;

-- Same access pattern as custom_statuses: members read; owner/member write; owner-only delete.
create policy "members can view swimlanes"
  on public.swimlanes for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create swimlanes"
  on public.swimlanes for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update swimlanes"
  on public.swimlanes for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete swimlanes"
  on public.swimlanes for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.stories drop column swimlane_id;
-- drop table public.swimlanes;
