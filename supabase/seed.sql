-- ============================================================
-- Local dev seed data. Only ever runs against the local Supabase
-- instance (via `supabase db reset` / `supabase start`), never against a
-- deployed project — see [db.seed] in config.toml.
--
-- Seeds a fixed dev user so `/auth/login` can offer a "Continue as dev
-- user" shortcut in local development, skipping the OAuth flow. The
-- password below is intentionally not a secret: it only ever grants
-- access to this throwaway local sandbox database.
-- ============================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, recovery_sent_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'dev@storylane.local',
  crypt('dev-local-only-password', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Dev User"}',
  now(), now(), '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  format(
    '{"sub":"%s","email":"%s"}',
    '11111111-1111-1111-1111-111111111111',
    'dev@storylane.local'
  )::jsonb,
  'email',
  '11111111-1111-1111-1111-111111111111',
  now(), now(), now()
)
on conflict (provider, provider_id) do nothing;

-- ============================================================
-- TASK-24: local Vault secrets for the slack-notify Edge Function pipeline.
-- Local-only (this file never runs against a deployed project); production
-- sets these two secrets manually. The URL points at the local edge runtime
-- reached from inside the Postgres container (host.docker.internal), and the
-- secret is a throwaway matching the local functions env — neither is
-- sensitive. Without these, notify_slack_event still records the outbox row
-- and just skips the POST, so the automated tests don't depend on them; they
-- exist so a manual local end-to-end delivery check can work.
--
-- TASK-128: vault.create_secret has no ON CONFLICT of its own and errors on
-- a duplicate `name` (secrets_name_idx) — and the Vault extension's own
-- storage isn't touched by `supabase db reset`'s schema reset, so a second
-- reset re-runs this seed against secrets that already exist from the first.
-- `supabase db reset` runs this whole file as one transaction, so that error
-- previously rolled back the entire seed, including the auth.users insert
-- above (despite its own ON CONFLICT succeeding) — leaving no dev user at
-- all. Guarded with an existence check instead of assuming a fresh vault.
-- ============================================================
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'slack_notify_url') then
    perform vault.create_secret(
      'http://host.docker.internal:54321/functions/v1/slack-notify',
      'slack_notify_url'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'slack_notify_secret') then
    perform vault.create_secret(
      'local-dev-slack-notify-secret',
      'slack_notify_secret'
    );
  end if;
end $$;
