← [SPEC.md](../SPEC.md)

## Supabase RLS Policy Guidelines

- Only users present in `project_members` can read or modify data for that project
- `viewer` role: SELECT only
- `member` role: SELECT / INSERT / UPDATE (own stories or assigned stories)
- `owner` role: all operations including DELETE
- Every new table with a `project_id` column gets its own policy set following
  the pattern above (2026-07-07 additions: `iteration_goals`, `swimlanes`,
  `recurring_stories`) — policies are never inherited
- Cross-project or cross-user operations that RLS cannot express row-by-row go
  through SECURITY DEFINER RPCs with explicit membership checks inside:
  `invite_member` (existing), user search for invites (capped results, minimal
  columns: id / username / display_name / avatar_url), and story Move/Copy
  between projects (caller must be a member of **both** projects)
- Project archive (`projects.archived_at`): set/cleared by owner only; while
  archived, non-owner writes to the project's data are rejected (read-only)
