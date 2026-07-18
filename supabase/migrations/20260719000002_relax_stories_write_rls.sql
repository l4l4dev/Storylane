-- ============================================================
-- TASK-70: align the board write-permission model. Owner decision
-- 2026-07-18 (a) — Pivotal-style: any project member may operate any
-- story on the board (move, reorder, transition, estimate), not just
-- the story's author or assignee. move_story_board (SECURITY DEFINER,
-- 20260715000008, latest redefinition 20260716000001) already enforced
-- exactly this ("owner","member", no author/assignee test) — this
-- migration brings the stories UPDATE RLS
-- policy up to the same rule, which also relaxes update_story and
-- transition_story (both SECURITY INVOKER, gated purely by this
-- policy) and the MCP server's direct `.from("stories").update()` path.
-- viewer stays read-only; stories DELETE and promote_story_to_epic stay
-- owner-only (decision (a) is about board operations, not deletion —
-- untouched, out of scope).
--
-- Single unconditional policy, not split by role: matches the existing
-- tasks/story_labels pattern (20260627000005), and a permissive USING
-- clause split into two role-scoped policies would just OR together —
-- no auditability gain, only more surface.
--
-- transition_story's compiled-in denial message ("you are not its
-- owner, author, or assignee", 20260717000004) is now stale prose —
-- left as-is rather than redefining a frozen migration; it only
-- surfaces for a viewer or a mid-request role-revocation race now
-- (project_role() is re-evaluated per statement, same race the
-- function's own FOR UPDATE re-check already documents). TASK-91
-- replaces the whole function with set_story_state, which is where
-- accurate wording will live going forward.
-- ============================================================

drop policy "owners or authors can update stories" on public.stories;

create policy "members can update stories"
  on public.stories for update to authenticated
  using (public.project_role(project_id) in ('owner', 'member'))
  with check (public.project_role(project_id) in ('owner', 'member'));

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop policy "members can update stories" on public.stories;
-- create policy "owners or authors can update stories"
--   on public.stories for update to authenticated
--   using (
--     public.project_role(project_id) = 'owner'
--     or (
--       public.project_role(project_id) = 'member'
--       and (created_by = auth.uid() or assignee_id = auth.uid())
--     )
--   )
--   with check (
--     public.project_role(project_id) = 'owner'
--     or (
--       public.project_role(project_id) = 'member'
--       and (created_by = auth.uid() or assignee_id = auth.uid())
--     )
--   );
