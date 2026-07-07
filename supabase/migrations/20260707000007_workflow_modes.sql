-- ============================================================
-- Task 14: Custom Workflow Modes (scope decided 2026-07-07 — TASK.md).
--
-- `projects.workflow_mode` is chosen at creation and fixed:
--   'pivotal' (default): the existing fixed state machine + iterations.
--   'free': a pure Trello-style board — DB-driven columns from
--   `custom_statuses`, any-to-any card moves, no iterations/velocity.
--
-- Free-mode stories track their column via `stories.custom_status_id`;
-- `stories.state` stays at its default and is ignored in free mode. The FK
-- deliberately has no ON DELETE action so a status with stories on it
-- can't be deleted (the app surfaces the FK error and the owner moves the
-- cards first).
-- ============================================================

alter table public.projects
  add column workflow_mode text not null default 'pivotal'
  check (workflow_mode in ('pivotal', 'free'));

create table public.custom_statuses (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null,
  color      text not null default '#6b7280',
  position   int  not null default 0,
  -- Marks statuses that count as "done" for the activity log and future
  -- reporting (2026-07-07 decision).
  is_done    boolean not null default false,
  created_at timestamptz not null default now()
);
create index custom_statuses_project_id_idx on public.custom_statuses (project_id);

-- Composite FK (not a plain id reference) so a story can only ever point
-- at a status of its own project — a tampered client could otherwise set
-- another project's status UUID, since FK existence checks don't go
-- through RLS.
alter table public.custom_statuses
  add constraint custom_statuses_id_project_id_key unique (id, project_id);

alter table public.stories add column custom_status_id uuid;
alter table public.stories
  add constraint stories_custom_status_project_fkey
  foreign key (custom_status_id, project_id)
  references public.custom_statuses (id, project_id);
create index stories_custom_status_id_idx on public.stories (custom_status_id);

alter table public.custom_statuses enable row level security;

-- Same access pattern as labels/epics: members read; owner/member write; owner-only delete.
create policy "members can view custom statuses"
  on public.custom_statuses for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create custom statuses"
  on public.custom_statuses for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update custom statuses"
  on public.custom_statuses for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete custom statuses"
  on public.custom_statuses for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.stories drop column custom_status_id;
-- drop table public.custom_statuses;
-- alter table public.projects drop column workflow_mode;
