-- ============================================================
-- TASK-71 (rls-security-reviewer 2026-07-18, High): close the cross-project
-- label attachment gap at its single chokepoint — the story_labels INSERT
-- policy. The original "members can add story_labels" (20260627000005) only
-- checked the caller's role on the STORY's project; it never verified that
-- label_id belongs to that same project. So a member of project A could attach
-- a project-B label to an A story (confirmed exploitable via set_story_labels,
-- create_story_tracker, and the pre-existing update_story_rpc).
--
-- Fixing the base policy fixes every write path at once (all three RPCs run
-- SECURITY INVOKER, so this WITH CHECK gates them). Legitimate callers are
-- unaffected: Web only offers project-scoped labels (actions.ts loads labels
-- filtered by the story's project_id), and the MCP resolveLabelIds creates/
-- finds labels within the story's project — neither ever passes a foreign id.
-- ============================================================

drop policy "members can add story_labels" on public.story_labels;

create policy "members can add story_labels"
  on public.story_labels for insert to authenticated
  with check (
    exists (
      select 1 from public.stories s
      where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
    )
    -- label_id must live in the same project as the story it is attached to.
    and exists (
      select 1
      from public.labels l
      join public.stories s on s.project_id = l.project_id
      where l.id = label_id and s.id = story_id
    )
  );

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop policy "members can add story_labels" on public.story_labels;
-- create policy "members can add story_labels"
--   on public.story_labels for insert to authenticated
--   with check (exists (
--     select 1 from public.stories s
--     where s.id = story_id and public.project_role(s.project_id) in ('owner', 'member')
--   ));
