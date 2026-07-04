-- ============================================================
-- One-time cleanup: future iterations become virtual boundary markers
-- instead of DB rows (Task 12.5 — Pivotal Tracker UX parity, see
-- spec/velocity.md "Automatic scheduling & rollover"). Delete iteration
-- rows that are still 'planned' and start after today, returning their
-- stories to the top of the backlog with relative order preserved.
-- `iterations.state = 'planned'` is no longer produced going forward but
-- stays in the CHECK constraint for compatibility.
-- ============================================================

create temporary table _t125_returning on commit drop as
select s.id, s.project_id,
       row_number() over (partition by s.project_id order by i.number, s.position) as rn
from public.stories s
join public.iterations i on i.id = s.iteration_id
where i.state = 'planned' and i.start_date > current_date;

create temporary table _t125_backlog on commit drop as
select s.id, s.project_id,
       row_number() over (partition by s.project_id order by s.position) as rn
from public.stories s
where s.iteration_id is null;

-- Move the returning stories to the top of the backlog, in iteration-number
-- then in-iteration-position order.
update public.stories s
set iteration_id = null,
    position = t.rn - 1
from _t125_returning t
where s.id = t.id;

-- Shift the stories that were already in the backlog down to make room.
update public.stories s
set position = t.rn - 1 + coalesce(cnt.n, 0)
from _t125_backlog t
left join (
  select project_id, count(*) as n from _t125_returning group by project_id
) cnt on cnt.project_id = t.project_id
where s.id = t.id;

delete from public.iterations
where state = 'planned' and start_date > current_date;

-- ============================================================
-- DOWN: not restorable. This migration permanently deletes future
-- 'planned' iteration rows (id/goal/velocity are gone) and rewrites
-- story positions/iteration_id to fold them back into the backlog.
-- There is no SQL that can reconstruct the pre-migration state; restore
-- from a database backup taken before this migration ran if reverting
-- is required.
-- ============================================================
