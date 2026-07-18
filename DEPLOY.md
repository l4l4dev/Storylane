# Deployment

Production runs on Vercel (app) + hosted Supabase (DB, Auth, Edge Functions,
project ref `iwmacbzlfeufzedjguce`).

## How a deploy works

Every push to `main` runs `.github/workflows/deploy.yml`:

1. `supabase db push` — applies pending migrations to the hosted DB
2. `supabase functions deploy` — deploys all Edge Functions in `supabase/functions/`
3. `curl $VERCEL_DEPLOY_HOOK_URL` — triggers the Vercel production build

The order is the point: the schema is always migrated before new app code goes
live. Vercel's own Git auto-deploy for `main` is disabled in
`apps/web/vercel.json` (`git.deploymentEnabled`), so the Deploy Hook is the
only production trigger. If `db push` fails, the workflow stops and no app
deploy happens — fix the migration and push again.

Preview deploys for non-main branches are unaffected.

## One-time setup (owner)

GitHub repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → Generate new token |
| `SUPABASE_DB_PASSWORD` | Supabase dashboard → Project Settings → Database → the database password (reset it there if unknown) |
| `VERCEL_DEPLOY_HOOK_URL` | Vercel → Storylane project → Settings → Git → Deploy Hooks → Create Hook (name: `production`, branch: `main`) → copy the URL |

## Manual fallback

If the workflow is unavailable, the same three steps by hand:

```sh
supabase db push
supabase functions deploy
# then trigger the Deploy Hook URL, or redeploy from the Vercel dashboard
```

## Versioning

The UI (Account settings page) shows `v<version> (<commit>)`, e.g.
`v0.1.0 (2209663)` — version from `apps/web/package.json`, commit from
Vercel's `VERCEL_GIT_COMMIT_SHA` (`(dev)` locally). To cut a release:

1. Bump `"version"` in `apps/web/package.json`
2. Commit, then tag the commit: `git tag v0.2.0`
3. `git push` and `git push --tags` — the push deploys as usual; the tag
   just records which commit the version name refers to

## Production checklist (done once, 2026-07-19)

- Supabase Auth: Site URL + Redirect URLs point at the production domain;
  GitHub/Google OAuth apps use the hosted callback
  (`https://iwmacbzlfeufzedjguce.supabase.co/auth/v1/callback`); the
  email/password provider is disabled (the dev seed user must never exist in
  production — do not run `supabase/seed.sql` against the hosted project)
- Vercel: Root Directory `apps/web`, "Include source files outside of the Root
  Directory" enabled, env vars `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
