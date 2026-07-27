-- TASK-205 follow-up (Codex review on PR #6): 20260720000002_iteration_capacity.sql
-- revoked table-level UPDATE on iterations and granted back only
-- `update (goal)` to authenticated -- the column grant is the PRIMARY guard
-- there, RLS is defense-in-depth behind it (see that migration's own
-- comment). 20260727100000_iteration_retro_notes.sql added the retro_notes
-- column but never extended this grant, so every owner/member save through
-- updateIterationRetroNotes hits 42501 (permission denied for table
-- iterations) before RLS is even evaluated. Confirmed live against a local
-- reset: PATCH .../iterations with retro_notes as the signed-in dev user
-- returned exactly that error. This was live in production from the moment
-- PR #6 deployed until this migration.

grant update (retro_notes) on public.iterations to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- revoke update (retro_notes) on public.iterations from authenticated;
