-- ============================================================
-- TASK-24 (decision-1 §3): move Slack notifications off the Web server
-- action onto a client-agnostic DB path, so an iOS write — which never runs
-- that action — still notifies. A trigger records the dispatch in an outbox
-- table (durable + testable via PostgREST) and fires an async pg_net POST to
-- the slack-notify Edge Function, which reads the project's webhook config
-- and posts to Slack. Reverses the 2026-07-07 owner decision to POST from the
-- server action (spec/integrations.md, rewritten in this change): that
-- decision predated iOS writes.
--
-- Advisor-reviewed 2026-07-21 (fable-advisor, Opus fallback). Outbox exists
-- rather than reading pg_net internals because: pg_net's worker drains
-- net.http_request_queue within ~1-2s (so an immediate read races it),
-- PostgREST does not expose the `net` schema (so the integration test can't
-- read it), and the queue rows carry the shared secret in their headers.
-- ============================================================

-- Present in the Supabase image already; idempotent for a fresh DB / prod.
create extension if not exists pg_net;

create table public.slack_notifications (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  event_type text not null check (event_type in ('story_state_changed', 'iteration_finalized', 'iteration_started')),
  -- Polymorphic reference (activity_logs.id for story_state_changed,
  -- iterations.id for the iteration_* events), so no FK — intentional: both
  -- target tables are append-only in normal operation (activity_logs is never
  -- deleted; iterations are not deleted), so there is nothing for a FK to
  -- protect against.
  ref_id     uuid not null,
  created_at timestamptz not null default now()
);
create index slack_notifications_project_id_idx on public.slack_notifications (project_id);

alter table public.slack_notifications enable row level security;

-- SELECT owner-only: this is internal integration-ops data (which project got
-- which notification), not a member-facing feed — matching integrations'
-- owner-only gate rather than activity_logs' member feed. No INSERT/UPDATE/
-- DELETE policies: RLS with no policy for a command denies authenticated/anon
-- outright (same pattern as activity_logs, 20260715000006), so only the
-- SECURITY DEFINER trigger (postgres, BYPASSRLS) and service_role (Edge
-- Function) ever write here.
create policy "owners can view slack notifications"
  on public.slack_notifications for select to authenticated
  using (public.project_role(project_id) = 'owner');

-- ------------------------------------------------------------
-- Records the dispatch and fires the async pg_net POST. SECURITY DEFINER and
-- owned by postgres (which holds BYPASSRLS — see the note in
-- 20260720000002_iteration_capacity.sql), so the slack_notifications INSERT
-- and the integrations / vault reads succeed regardless of which client's
-- role caused the write.
--
-- Gated on an active Slack integration so a project without Slack never grows
-- an outbox row or enqueues an HTTP request. The Edge Function re-reads
-- is_active at send time (the ~1-2s pg_net delay is a window in which an owner
-- could disable the integration), so this gate is a cheap pre-filter, not the
-- authority.
--
-- The Edge Function URL and the shared secret it checks live in Vault, never
-- in source (public repo). A DB with neither secret configured still records
-- the outbox row, then skips the POST rather than erroring the caller's write.
-- ------------------------------------------------------------
create or replace function public.notify_slack_event(p_type text, p_project_id uuid, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.integrations
    where project_id = p_project_id and provider = 'slack' and is_active
  ) then
    return;
  end if;

  insert into public.slack_notifications (project_id, event_type, ref_id)
  values (p_project_id, p_type, p_ref_id);

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'slack_notify_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'slack_notify_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', p_type, 'ref_id', p_ref_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-slack-notify-secret', v_secret)
  );
end;
$$;

revoke execute on function public.notify_slack_event(text, uuid, uuid) from public, anon, authenticated;

-- One trigger function for all three events — each passes its event type via
-- TG_ARGV and reads NEW.id (the ref) + NEW.project_id the same way.
create or replace function public.trg_slack_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_slack_event(tg_argv[0], new.project_id, new.id);
  return new;
end;
$$;

revoke execute on function public.trg_slack_notify() from public, anon, authenticated;

-- Story state changes ride the activity_logs row log_story_activity already
-- writes for every state_id change (the single client-agnostic path,
-- ARCHITECTURE.md). ref = activity_logs.id.
create trigger activity_logs_slack_notify
  after insert on public.activity_logs
  for each row
  when (new.action = 'story.state_changed')
  execute function public.trg_slack_notify('story_state_changed');

-- Iteration finalize / start are read straight off the iterations table (NOT
-- activity_logs, which spec/screens.md defines as a story/comment feed).
-- finalize_iteration sets state='done' (finalize, incl. skips) and INSERTs the
-- successor row (start) for any client. ref = iterations.id.
create trigger iterations_slack_notify_finalized
  after update of state on public.iterations
  for each row
  when (new.state = 'done' and old.state is distinct from new.state)
  execute function public.trg_slack_notify('iteration_finalized');

create trigger iterations_slack_notify_started
  after insert on public.iterations
  for each row
  execute function public.trg_slack_notify('iteration_started');

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger iterations_slack_notify_started on public.iterations;
-- drop trigger iterations_slack_notify_finalized on public.iterations;
-- drop trigger activity_logs_slack_notify on public.activity_logs;
-- drop function public.trg_slack_notify();
-- drop function public.notify_slack_event(text, uuid, uuid);
-- drop table public.slack_notifications;
-- (restore the notifySlack calls in apps/web from before this change, and
--  drop extension pg_net if nothing else uses it)
