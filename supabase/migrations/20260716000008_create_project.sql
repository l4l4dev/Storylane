-- ============================================================
-- TASK-58 item 4 (AC#4): atomic project creation.
-- Advisor-approved (Fable, 2026-07-16).
--
-- createProject inserted the projects row, then — in a separate request — the
-- free-mode template columns. A failure between the two left a free project
-- with no board columns, and free-mode drops have nowhere to land. Fold both
-- into one transaction.
--
-- SECURITY INVOKER (the default): the projects INSERT runs as the caller, whose
-- created_by defaults to auth.uid() and satisfies the "created_by = auth.uid()"
-- INSERT policy; the AFTER-INSERT handle_new_project trigger (SECURITY DEFINER)
-- registers the caller as owner in the same transaction, so the STABLE
-- project_role() in the custom_statuses INSERT policy already sees that
-- membership. Nothing here needs to bypass RLS.
--
-- Scope is projects + statuses only. Member invitations stay in TS: the AC is
-- "all-or-nothing INCLUDING default statuses", and an invite that fails a lookup
-- must not roll back the whole project (spec: the composer surfaces
-- ?invite_failed=N and keeps the project).
--
-- Statuses arrive as a jsonb array so the starter templates stay defined in one
-- place (dashboard/actions.ts); position is omitted so each row draws from the
-- sequence (TASK-58 position invariant), evaluated in array order via WITH
-- ORDINALITY.
-- ============================================================

create function public.create_project(
  p_name text,
  p_iteration_length int,
  p_point_scale text,
  p_velocity_window int,
  p_workflow_mode text,
  p_statuses jsonb,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  insert into public.projects (
    name, description, iteration_length, point_scale, velocity_window, workflow_mode
  ) values (
    p_name, p_description, p_iteration_length, p_point_scale, p_velocity_window, p_workflow_mode
  )
  returning id into v_project_id;

  if p_statuses is not null and jsonb_array_length(p_statuses) > 0 then
    insert into public.custom_statuses (project_id, name, color, is_done)
    select v_project_id, s.elem->>'name', s.elem->>'color', (s.elem->>'is_done')::boolean
    from jsonb_array_elements(p_statuses) with ordinality as s(elem, ord)
    order by s.ord;
  end if;

  return v_project_id;
end;
$$;

revoke execute on function
  public.create_project(text, int, text, int, text, jsonb, text)
  from public;
grant execute on function
  public.create_project(text, int, text, int, text, jsonb, text)
  to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.create_project(text, int, text, int, text, jsonb, text);
