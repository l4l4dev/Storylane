-- ============================================================
-- TASK-183 (fable-advisor review): default epic_color on containerization.
--
-- A normal story has no epic_color (only meaningful once is_container=true,
-- doc-18 §2), so containerizing one via split_story or the Parent picker left
-- the resulting epic colorless — a regression vs. the dropped epics table's
-- own default (#6366f1). Fixed on recompute_is_container's false->true flip
-- itself (the single authority for containerization, doc-18 §4) rather than
-- in split_story specifically, since the Parent picker (TASK-184) triggers
-- the exact same flip through a plain parent_id UPDATE.
--
-- Full replacement of 20260724054954's recompute_is_container — verbatim
-- except the epic_color default added to the containerizing UPDATE. Grants
-- unaffected (CREATE OR REPLACE preserves them; this function already has
-- execute revoked from public/authenticated, unchanged here).
-- ============================================================

create or replace function public.recompute_is_container(p_parent uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row          public.stories%rowtype;
  v_has_children boolean;
begin
  if p_parent is null then
    return;
  end if;

  select * into v_row from public.stories where id = p_parent for update;
  if not found then
    return; -- parent already deleted (its children's parent_id SET NULL first)
  end if;

  v_has_children := exists (select 1 from public.stories where parent_id = p_parent);

  if v_has_children and not v_row.is_container then
    -- false -> true. Audit the points that are about to be lost (the only place
    -- the value survives — doc-18 §4). state_id/iteration_id are cleared in the
    -- same statement so the off-board CHECK (doc-18 §4 / TASK-178) holds;
    -- completed_at is cleared for free by maintain_story_completed_at (BEFORE
    -- UPDATE) since state_id goes NULL. epic_color defaults to the dropped
    -- epics table's own default only when the story didn't already carry one
    -- (coalesce — never overwrites an existing pick).
    if v_row.points is not null then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        v_row.project_id, v_row.id, auth.uid(), 'story.containerized',
        jsonb_build_object('old_points', v_row.points)
      );
    end if;
    update public.stories
      set is_container = true,
          points = null,
          state_id = null,
          iteration_id = null,
          epic_color = coalesce(epic_color, '#6366f1')
      where id = p_parent;
  elsif not v_has_children and v_row.is_container then
    update public.stories set is_container = false where id = p_parent;
  end if;
end;
$$;

-- DOWN (rollback — not auto-applied):
-- (restore recompute_is_container from 20260724054954_epic_story_unification_triggers.sql)
