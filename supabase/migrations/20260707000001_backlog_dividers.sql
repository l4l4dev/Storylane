-- ============================================================
-- backlog_dividers — freeform planning dividers for the List view's
-- Backlog section (Task 15 follow-up, 2026-07-07). Unlike the automatic,
-- velocity-based "Iteration #N" markers (spec/velocity.md), these are
-- user-created labeled rows a PO can insert anywhere in the backlog to
-- group stories for planning (e.g. "Phase 2") — purely organizational, no
-- effect on velocity/iteration assignment.
--
-- `position` shares one dense sequence with `stories.position` *within a
-- project's backlog* (stories not yet in an iteration): whenever the
-- backlog is reordered, every story and divider in it is resequenced
-- together so the two tables' position values interleave consistently
-- when merged by the app layer (see lib/utils/iterations.ts
-- "buildBacklogRows"). Positions in other zones (current iteration,
-- Icebox) are unaffected.
-- ============================================================

create table public.backlog_dividers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label      text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index backlog_dividers_project_id_idx on public.backlog_dividers (project_id);

alter table public.backlog_dividers enable row level security;

-- Same access pattern as labels/epics: members read; owner/member write; owner-only delete.
create policy "members can view backlog dividers"
  on public.backlog_dividers for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can create backlog dividers"
  on public.backlog_dividers for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "members can update backlog dividers"
  on public.backlog_dividers for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

create policy "owners can delete backlog dividers"
  on public.backlog_dividers for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- DOWN (rollback — not auto-applied by `supabase db reset`/`db push`;
-- run manually against the target DB if this migration needs reverting).
-- drop table public.backlog_dividers;
