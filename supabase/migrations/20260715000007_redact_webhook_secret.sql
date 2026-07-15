-- ============================================================
-- TASK-63 (split from TASK-55 sub-area 3): redact integrations.webhook_secret
-- from client reads. Codex (doc-1): config.webhook_secret was returned to the
-- owner's browser via the owner SELECT policy and prefilled into the settings
-- form, so the plaintext HMAC secret round-tripped through the client on every
-- settings render. RLS gates *rows*, not columns — an owner legitimately sees
-- the row, so the only way to hide one field is column-level SELECT privilege.
--
-- Move the secret out of the `config` jsonb into a dedicated column, then drop
-- SELECT on just that column for `authenticated`. service_role keeps its
-- table-level grant (20260707000006) so the git-webhook Edge Function still
-- reads it. INSERT/UPDATE stay table-level, so the owner can still set/rotate
-- the secret — they just can't read it back.
-- ============================================================

alter table public.integrations add column webhook_secret text;

-- One-time backfill: lift the existing secret out of config, then strip the key
-- so the plaintext no longer lives anywhere `authenticated` can SELECT.
update public.integrations
  set webhook_secret = config->>'webhook_secret'
  where config ? 'webhook_secret';
update public.integrations
  set config = config - 'webhook_secret'
  where config ? 'webhook_secret';

-- Column-level SELECT: revoke the table grant (from 20260630000002_grants.sql)
-- and re-grant SELECT on every column EXCEPT webhook_secret. INSERT/UPDATE/DELETE
-- are separate privilege types and stay table-level, so writes are unaffected.
-- New columns added to this table in future migrations are NOT auto-SELECTable
-- by authenticated once the grant is column-level — that is the intended
-- fail-closed behaviour, but it means such a migration must re-grant the column.
revoke select on public.integrations from authenticated;
grant select (id, project_id, provider, config, is_active, created_at)
  on public.integrations to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- update public.integrations set config = config || jsonb_build_object('webhook_secret', webhook_secret)
--   where webhook_secret is not null;
-- revoke select on public.integrations from authenticated;
-- grant select on public.integrations to authenticated;
-- alter table public.integrations drop column webhook_secret;
