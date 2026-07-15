# /db-migrate

Steps for creating and applying Supabase migrations.

## Create a New Migration

```bash
supabase migration new <name>
# e.g. supabase migration new add_story_labels_table
```

## Checklist

1. Verify consistency with the data model in `spec/data-model.md`
2. Always define RLS policies in the same migration
3. Write a DOWN migration for rollback
4. Check the impact on existing data when adding or modifying columns
5. **Every new function manages its own EXECUTE grants** — the schema is NOT
   private-by-default (Postgres grants EXECUTE to PUBLIC on `CREATE FUNCTION`,
   and `alter default privileges ... revoke` does not suppress that once a
   pg_default_acl row exists, TASK-55). Forgetting = the function ships callable
   by `authenticated`/`anon`. Pick the auth boundary:
   - **User-facing RPC** (called with the anon key by a logged-in user): keep an
     internal `project_role()` / `is_project_member()` check that fails closed
     (see `finalize_iteration`), and add it to `AUTHENTICATED_ALLOWLIST` in
     `apps/web/lib/utils/grant-lockdown.integration.test.ts`. It relies on the
     inherited PUBLIC/`authenticated` EXECUTE.
   - **Service-role-only RPC** (called by an Edge Function under the service-role
     key, e.g. `finish_story_from_git`) **or an internal helper / trigger body**:
     `revoke execute on function … from public, authenticated;` in the same
     migration. `service_role` keeps EXECUTE via its default privileges.
   - The `grant-lockdown` integration test fails if any public function outside
     the allowlist is `authenticated`/`anon`-executable — run it after adding a
     function.

## RLS Policy Template

```sql
-- Enable RLS on the table
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

-- Members can read
CREATE POLICY "project members can select"
ON public.stories FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = stories.project_id
    AND user_id = auth.uid()
  )
);

-- Owners and members can insert
CREATE POLICY "members can insert"
ON public.stories FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = stories.project_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'member')
  )
);
```

## Apply

```bash
supabase db push
```

Always verify locally with `supabase db reset` before applying.
