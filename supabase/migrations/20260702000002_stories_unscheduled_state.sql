-- ============================================================
-- stories.state: add 'unscheduled' (Icebox), make it the default
-- (Task 12.5 — Pivotal Tracker UX parity, see spec/data-model.md)
-- Existing rows are left as-is (unstarted = Backlog); only new stories
-- start in the Icebox.
-- ============================================================

alter table public.stories drop constraint stories_state_check;

alter table public.stories add constraint stories_state_check
  check (state in ('unscheduled', 'unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected'));

alter table public.stories alter column state set default 'unscheduled';

-- ============================================================
-- DOWN (rollback — not auto-applied by `supabase db reset`/`db push`;
-- run manually against the target DB if this migration needs reverting).
-- Only safe if no row has been set to 'unscheduled' yet.
-- ============================================================
-- alter table public.stories alter column state set default 'unstarted';
-- alter table public.stories drop constraint stories_state_check;
-- alter table public.stories add constraint stories_state_check
--   check (state in ('unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected'));
