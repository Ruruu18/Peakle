-- Priority 3: resilient real-time operations, push notification outbox,
-- conflict-safe offline mutations, venue announcements, and staff roles.
-- This migration is intentionally rerunnable after a partial SQL Editor run.

alter table public.open_play_sessions
  add column if not exists operation_revision bigint not null default 0;

alter table public.venue_members drop constraint if exists venue_members_role_check;
alter table public.venue_members add constraint venue_members_role_check
  check (role in ('owner', 'manager', 'front_desk', 'court_monitor', 'scorer', 'viewer'));

create or replace function public.open_play_staff_role(target_session text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when session.organizer_id = auth.uid() then 'owner'
    else membership.role
  end
  from public.open_play_sessions session
  left join public.venue_members membership
    on membership.venue_id = session.venue_id and membership.user_id = auth.uid()
  where session.id = target_session
$$;

create or replace function public.can_view_open_play(target_session text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.open_play_staff_role(target_session) is not null
$$;

create or replace function public.owns_open_play(target_session text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.open_play_staff_role(target_session) in
    ('owner', 'manager', 'front_desk', 'court_monitor', 'scorer'), false)
$$;

revoke all on function public.open_play_staff_role(text) from public;
revoke all on function public.can_view_open_play(text) from public;
grant execute on function public.open_play_staff_role(text), public.can_view_open_play(text) to authenticated;

-- Viewers receive SELECT through separate policies; all existing mutation
-- policies continue to use owns_open_play and therefore exclude viewers.
drop policy if exists "staff view open play sessions" on public.open_play_sessions;
create policy "staff view open play sessions" on public.open_play_sessions
  for select to authenticated using (public.can_view_open_play(id));
drop policy if exists "staff view open play players" on public.open_play_players;
create policy "staff view open play players" on public.open_play_players
  for select to authenticated using (public.can_view_open_play(session_id));
drop policy if exists "staff view open play courts" on public.open_play_courts;
create policy "staff view open play courts" on public.open_play_courts
  for select to authenticated using (public.can_view_open_play(session_id));
drop policy if exists "staff view open play matches" on public.open_play_matches;
create policy "staff view open play matches" on public.open_play_matches
  for select to authenticated using (public.can_view_open_play(session_id));
drop policy if exists "staff view open play lineups" on public.open_play_match_players;
create policy "staff view open play lineups" on public.open_play_match_players
  for select to authenticated using (exists (
    select 1 from public.open_play_matches match
    where match.id = match_id and public.can_view_open_play(match.session_id)
  ));
drop policy if exists "staff view open play scores" on public.open_play_score_events;
create policy "staff view open play scores" on public.open_play_score_events
  for select to authenticated using (exists (
    select 1 from public.open_play_matches match
    where match.id = match_id and public.can_view_open_play(match.session_id)
  ));

create or replace function public.set_venue_staff_role(
  p_venue_id text, p_user_id uuid, p_role text
) returns public.venue_members
language plpgsql security definer set search_path = '' as $$
declare current_role text; result public.venue_members;
begin
  select role into current_role from public.venue_members
  where venue_id = p_venue_id and user_id = auth.uid();
  if current_role not in ('owner', 'manager') then
    raise exception 'Owner or manager permission required';
  end if;
  if p_role not in ('manager', 'front_desk', 'court_monitor', 'scorer', 'viewer') then
    raise exception 'Choose a valid staff role';
  end if;
  if p_user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  insert into public.venue_members(venue_id, user_id, role)
  values (p_venue_id, p_user_id, p_role)
  on conflict (venue_id, user_id) do update set role = excluded.role
  returning * into result;
  return result;
end $$;

create or replace function public.remove_venue_staff(p_venue_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_role text; target_role text;
begin
  select role into current_role from public.venue_members
  where venue_id = p_venue_id and user_id = auth.uid();
  select role into target_role from public.venue_members
  where venue_id = p_venue_id and user_id = p_user_id;
  if current_role not in ('owner', 'manager') then raise exception 'Owner or manager permission required'; end if;
  if p_user_id = auth.uid() or target_role = 'owner' then raise exception 'The venue owner cannot be removed'; end if;
  delete from public.venue_members where venue_id = p_venue_id and user_id = p_user_id;
end $$;

revoke all on function public.set_venue_staff_role(text, uuid, text), public.remove_venue_staff(text, uuid) from public;
grant execute on function public.set_venue_staff_role(text, uuid, text), public.remove_venue_staff(text, uuid) to authenticated;

drop policy if exists "venue staff read own access" on public.venue_members;
drop policy if exists "venue staff read venue roster" on public.venue_members;
create policy "venue staff read venue roster" on public.venue_members
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.venue_members me
      where me.venue_id = venue_members.venue_id and me.user_id = auth.uid()
        and me.role in ('owner', 'manager')
    )
  );

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  device_id text not null,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, device_id),
  unique(expo_push_token)
);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id text references public.open_play_sessions(id) on delete cascade,
  kind text not null check (kind in ('approval', 'waitlist_promotion', 'check_in_reminder', 'court_assignment', 'match_point', 'result', 'cancellation', 'venue_announcement')),
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  push_status text not null default 'pending' check (push_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  push_attempts integer not null default 0,
  push_error text,
  push_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.user_notifications add column if not exists push_claimed_at timestamptz;
create index if not exists user_notifications_inbox_idx on public.user_notifications(user_id, created_at desc);
create index if not exists user_notifications_outbox_idx on public.user_notifications(push_status, created_at)
  where push_status in ('pending', 'failed');

alter table public.device_push_tokens enable row level security;
alter table public.user_notifications enable row level security;
drop policy if exists "users manage own push tokens" on public.device_push_tokens;
create policy "users manage own push tokens" on public.device_push_tokens
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users read own notifications" on public.user_notifications;
create policy "users read own notifications" on public.user_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users mark own notifications read" on public.user_notifications;
revoke insert, update, delete on public.user_notifications from authenticated;
grant select on public.user_notifications to authenticated;

create or replace function public.claim_push_notifications(p_limit integer default 100)
returns setof public.user_notifications
language sql security definer set search_path = '' as $$
  with claimable as (
    select id from public.user_notifications
    where push_attempts < 5 and (
      push_status in ('pending', 'failed')
      or (push_status = 'sending' and push_claimed_at < now() - interval '5 minutes')
    )
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.user_notifications notice
  set push_status = 'sending', push_attempts = push_attempts + 1, push_claimed_at = now()
  from claimable where notice.id = claimable.id
  returning notice.*
$$;
revoke all on function public.claim_push_notifications(integer) from public;
grant execute on function public.claim_push_notifications(integer) to service_role;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.user_notifications set read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = auth.uid()
$$;
revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create table if not exists public.open_play_announcements (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 3 and 280),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.open_play_announcements enable row level security;
drop policy if exists "session participants read announcements" on public.open_play_announcements;
create policy "session participants read announcements" on public.open_play_announcements
  for select to authenticated using (
    public.can_view_open_play(session_id) or exists (
      select 1 from public.open_play_players player
      where player.session_id = open_play_announcements.session_id
        and player.user_id = auth.uid() and player.registration_status = 'approved'
    )
  );
drop policy if exists "session staff create announcements" on public.open_play_announcements;
create policy "session staff create announcements" on public.open_play_announcements
  for insert to authenticated with check (public.owns_open_play(session_id) and created_by = auth.uid());

create or replace function public.notify_open_play_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare session_name text; previous_status text;
begin
  previous_status := case when tg_op = 'INSERT' then null else old.registration_status end;
  if new.user_id is null or new.registration_status is not distinct from previous_status then return new; end if;
  select name into session_name from public.open_play_sessions where id = new.session_id;
  if new.registration_status = 'approved' then
    insert into public.user_notifications(user_id, session_id, kind, title, body, data)
    values(new.user_id, new.session_id,
      case when previous_status = 'waitlisted' then 'waitlist_promotion' else 'approval' end,
      case when previous_status = 'waitlisted' then 'You are off the waitlist' else 'Open-play request approved' end,
      session_name || ' has a place for you. Check in when you arrive.',
      jsonb_build_object('sessionId', new.session_id));
  end if;
  return new;
end $$;
drop trigger if exists notify_open_play_registration_after_update on public.open_play_players;
drop trigger if exists notify_open_play_registration_after_write on public.open_play_players;
create trigger notify_open_play_registration_after_write after insert or update of registration_status on public.open_play_players
for each row execute function public.notify_open_play_registration();

create or replace function public.notify_open_play_player_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare match_row public.open_play_matches; court_number integer; session_name text;
begin
  if new.user_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'playing' then
    select match.* into match_row from public.open_play_matches match
    join public.open_play_match_players lineup on lineup.match_id = match.id
    where lineup.player_id = new.id and match.status = 'live' order by match.started_at desc limit 1;
    select court.court_number, session.name into court_number, session_name
    from public.open_play_sessions session join public.open_play_courts court on court.id = match_row.session_court_id
    where session.id = new.session_id;
    insert into public.user_notifications(user_id, session_id, kind, title, body, data)
    values(new.user_id, new.session_id, 'court_assignment', 'You are on court',
      'Head to Court ' || court_number || ' for ' || session_name || '.',
      jsonb_build_object('sessionId', new.session_id, 'matchId', match_row.id, 'court', court_number));
  end if;
  return new;
end $$;
drop trigger if exists notify_open_play_player_status_after_update on public.open_play_players;
create trigger notify_open_play_player_status_after_update after update of status on public.open_play_players
for each row execute function public.notify_open_play_player_status();

create or replace function public.notify_open_play_match()
returns trigger language plpgsql security definer set search_path = '' as $$
declare player_user uuid; session_name text; is_match_point boolean;
begin
  select name into session_name from public.open_play_sessions where id = new.session_id;
  is_match_point := new.status = 'live' and (
    (new.home_score >= 10 and new.home_score - new.away_score >= 1) or
    (new.away_score >= 10 and new.away_score - new.home_score >= 1)
  ) and not (
    (old.home_score >= 10 and old.home_score - old.away_score >= 1) or
    (old.away_score >= 10 and old.away_score - old.home_score >= 1)
  );
  for player_user in
    select player.user_id from public.open_play_match_players lineup
    join public.open_play_players player on player.id = lineup.player_id
    where lineup.match_id = new.id and player.user_id is not null
  loop
    if is_match_point then
      insert into public.user_notifications(user_id, session_id, kind, title, body, data)
      values(player_user, new.session_id, 'match_point', 'Match point',
        'Your match is at ' || new.home_score || '–' || new.away_score || '.',
        jsonb_build_object('sessionId', new.session_id, 'matchId', new.id));
    end if;
    if new.status = 'completed' and old.status = 'live' then
      insert into public.user_notifications(user_id, session_id, kind, title, body, data)
      values(player_user, new.session_id, 'result', 'Result recorded',
        session_name || ' finished ' || new.home_score || '–' || new.away_score || '.',
        jsonb_build_object('sessionId', new.session_id, 'matchId', new.id));
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists notify_open_play_match_after_update on public.open_play_matches;
create trigger notify_open_play_match_after_update after update of home_score, away_score, status on public.open_play_matches
for each row execute function public.notify_open_play_match();

create or replace function public.notify_open_play_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.user_notifications(user_id, session_id, kind, title, body, data)
    select player.user_id, new.id, 'cancellation', 'Open play cancelled',
      new.name || ' was cancelled by the organizer.', jsonb_build_object('sessionId', new.id)
    from public.open_play_players player
    where player.session_id = new.id and player.user_id is not null
      and player.registration_status in ('requested', 'approved', 'waitlisted');
  end if;
  return new;
end $$;
drop trigger if exists notify_open_play_session_after_update on public.open_play_sessions;
create trigger notify_open_play_session_after_update after update of status on public.open_play_sessions
for each row execute function public.notify_open_play_session();

create or replace function public.notify_open_play_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_notifications(user_id, session_id, kind, title, body, data)
  select player.user_id, new.session_id, 'venue_announcement', 'Venue announcement', new.body,
    jsonb_build_object('sessionId', new.session_id, 'announcementId', new.id)
  from public.open_play_players player
  where player.session_id = new.session_id and player.user_id is not null
    and player.registration_status = 'approved' and player.departed_at is null;
  return new;
end $$;
drop trigger if exists notify_open_play_announcement_after_insert on public.open_play_announcements;
create trigger notify_open_play_announcement_after_insert after insert on public.open_play_announcements
for each row execute function public.notify_open_play_announcement();

-- Called by Supabase Cron every five minutes. The unique time bucket prevents
-- duplicate reminders when jobs overlap.
create unique index if not exists user_notifications_reminder_dedupe_idx
  on public.user_notifications(user_id, session_id, kind, ((data->>'startBucket')))
  where kind = 'check_in_reminder';
create or replace function public.queue_open_play_check_in_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  insert into public.user_notifications(user_id, session_id, kind, title, body, data)
  select player.user_id, session.id, 'check_in_reminder', 'Open play starts soon',
    session.name || ' starts at ' || to_char(session.scheduled_start at time zone 'Asia/Manila', 'FMHH12:MI AM') || '.',
    jsonb_build_object('sessionId', session.id, 'startBucket', date_trunc('minute', session.scheduled_start)::text)
  from public.open_play_sessions session join public.open_play_players player on player.session_id = session.id
  where session.status = 'active' and session.scheduled_start between now() + interval '25 minutes' and now() + interval '35 minutes'
    and player.user_id is not null and player.registration_status = 'approved' and player.checked_in_at is null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end $$;
revoke all on function public.queue_open_play_check_in_reminders() from public;

create table if not exists public.open_play_operations (
  id uuid primary key,
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  base_revision bigint not null,
  applied_revision bigint not null,
  operation jsonb not null,
  created_at timestamptz not null default now(),
  unique(session_id, id)
);
alter table public.open_play_operations enable row level security;
drop policy if exists "staff read operation log" on public.open_play_operations;
create policy "staff read operation log" on public.open_play_operations
  for select to authenticated using (public.can_view_open_play(session_id));

create or replace function public.apply_open_play_operation(
  p_operation_id uuid, p_session_id text, p_base_revision bigint, p_operation jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare session_row public.open_play_sessions; player_id text; next_revision bigint; existing jsonb;
begin
  select operation into existing from public.open_play_operations
  where id = p_operation_id and session_id = p_session_id;
  if found then
    return jsonb_build_object('revision', (select applied_revision from public.open_play_operations where id = p_operation_id), 'replayed', true);
  end if;
  select * into session_row from public.open_play_sessions where id = p_session_id for update;
  if session_row.id is null or session_row.status <> 'active' then raise exception 'Active session not found'; end if;
  if not public.owns_open_play(p_session_id) then raise exception 'Session staff permission required'; end if;
  if p_base_revision <> session_row.operation_revision then
    return jsonb_build_object('conflict', true, 'revision', session_row.operation_revision);
  end if;
  player_id := p_operation->>'playerId';
  case p_operation->>'type'
    when 'set_priority' then
      update public.open_play_players set priority_boost = greatest(-10, least(10, (p_operation->>'value')::integer))
      where id = player_id and session_id = p_session_id and status = 'waiting';
    when 'mark_done' then
      update public.open_play_players set status = 'done', departed_at = now(), queue_position = null
      where id = player_id and session_id = p_session_id and status = 'waiting';
    when 'return_to_queue' then
      update public.open_play_players set status = 'waiting', departed_at = null, waiting_since = now(),
        queue_position = (select coalesce(max(queue_position), -1) + 1 from public.open_play_players where session_id = p_session_id)
      where id = player_id and session_id = p_session_id and status = 'done';
    else raise exception 'Unsupported offline operation';
  end case;
  if not found then raise exception 'The player changed on another device'; end if;
  next_revision := session_row.operation_revision + 1;
  update public.open_play_sessions set operation_revision = next_revision where id = p_session_id;
  insert into public.open_play_operations(id, session_id, actor_id, base_revision, applied_revision, operation)
  values(p_operation_id, p_session_id, auth.uid(), p_base_revision, next_revision, p_operation);
  return jsonb_build_object('revision', next_revision, 'conflict', false);
end $$;
revoke all on function public.apply_open_play_operation(uuid, text, bigint, jsonb) from public;
grant execute on function public.apply_open_play_operation(uuid, text, bigint, jsonb) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'open_play_courts', 'open_play_matches', 'open_play_match_players',
    'open_play_score_events', 'open_play_rotation_decisions',
    'open_play_announcements', 'user_notifications'
  ] loop
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

alter table public.open_play_sessions replica identity full;
alter table public.open_play_players replica identity full;
alter table public.open_play_matches replica identity full;
alter table public.user_notifications replica identity full;
