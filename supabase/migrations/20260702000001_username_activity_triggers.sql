-- ============================================================
-- profiles.username (Task 9 prerequisite: @mention support)
-- ============================================================

alter table public.profiles add column username text;

-- Slugifies `base` into a unique, DB-safe handle (lowercase, [a-z0-9_],
-- 3-30 chars), appending a numeric suffix on collision. Used both to
-- backfill existing rows and to generate a username on first sign-in.
create or replace function public.generate_username(base text)
returns text
language plpgsql
as $$
declare
  slug      text;
  candidate text;
  suffix    int := 0;
begin
  slug := lower(regexp_replace(coalesce(base, ''), '[^a-z0-9]+', '_', 'gi'));
  slug := trim(both '_' from slug);
  if length(slug) < 3 then
    slug := rpad(coalesce(nullif(slug, ''), 'user'), 3, '0');
  end if;
  slug := left(slug, 24);

  candidate := slug;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(slug, 24) || suffix::text;
  end loop;

  return candidate;
end;
$$;

-- Backfill row by row (not a set-based UPDATE) so each call to
-- generate_username sees usernames assigned earlier in the same backfill.
do $$
declare
  r record;
begin
  for r in select id, display_name from public.profiles where username is null order by created_at loop
    update public.profiles set username = public.generate_username(r.display_name) where id = r.id;
  end loop;
end;
$$;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_key unique (username),
  add constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,30}$');

-- Extend the existing on_auth_user_created flow to assign a username too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  insert into public.profiles (id, display_name, username, avatar_url)
  values (
    new.id,
    v_display_name,
    public.generate_username(v_display_name),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ============================================================
-- activity_logs auto-recording (Task 9 prerequisite)
-- Single recording path for all clients (Web/iOS/Edge Functions) — see
-- ARCHITECTURE.md. security definer so the trigger can write regardless
-- of the caller's own activity_logs insert grant.
-- ============================================================

create or replace function public.log_story_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.created', jsonb_build_object('title', new.title)
    );
  elsif tg_op = 'UPDATE' and new.state is distinct from old.state then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.state_changed', jsonb_build_object('from', old.state, 'to', new.state)
    );
  end if;
  return new;
end;
$$;

create trigger stories_log_activity
  after insert or update on public.stories
  for each row execute function public.log_story_activity();

create or replace function public.log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.stories where id = new.story_id;

  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_project_id, new.story_id, coalesce(auth.uid(), new.author_id),
    'comment.added', jsonb_build_object('comment_id', new.id)
  );
  return new;
end;
$$;

create trigger comments_log_activity
  after insert on public.comments
  for each row execute function public.log_comment_activity();
