-- Lets a user configure how many days the My Work Done log reaches back
-- (previously a hardcoded 7 in the web app) — entries older than this fall
-- out of Done into the read-only archive view. Same grant shape as the other
-- profiles columns added for My Work: profiles' own-row UPDATE policy already
-- covers this row, but the column-by-column grant lockdown
-- (20260719000001_profiles_is_agent.sql) means this NEW column needs its own
-- explicit grant.

alter table public.profiles
  add column my_work_done_window_days int not null default 7;

alter table public.profiles
  add constraint profiles_my_work_done_window_days_range
    check (my_work_done_window_days between 1 and 90);

grant update (my_work_done_window_days) on public.profiles to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.profiles
--   drop constraint profiles_my_work_done_window_days_range;
-- alter table public.profiles drop column my_work_done_window_days;
