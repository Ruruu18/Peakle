-- Complete match push coverage for nearby invitations, Competitive Hub
-- matchmaking, and organizers who are hosting (but not playing in) open play.
-- Notifications remain account-scoped, so Player and Organizer workspaces use
-- the same inbox and device tokens.

alter table public.user_notifications
  drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications
  add constraint user_notifications_kind_check check (kind in (
    'approval','waitlist_promotion','check_in_reminder','court_assignment','match_point','result',
    'cancellation','venue_announcement','booking_reminder','court_waitlist','booking_changed',
    'booking_confirmed','match_invite','match_invite_response','match_found','organizer_match'
  ));

-- Every trigger below supplies a stable event key. This protects against a
-- repeated RPC response or a migration being reapplied after a partial run.
create unique index if not exists user_notifications_match_event_dedupe_idx
  on public.user_notifications(user_id, kind, ((data->>'dedupeKey')))
  where data ? 'dedupeKey'
    and kind in ('match_invite','match_invite_response','match_found','organizer_match');

-- Expo tokens identify an app installation, not an account. Reassign a token
-- atomically when a different account signs in on the same phone so the prior
-- account cannot keep receiving that device's alerts.
create or replace function public.register_device_push_token(
  p_expo_push_token text,
  p_platform text,
  p_device_id text
)
returns public.device_push_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  registered public.device_push_tokens;
begin
  if auth.uid() is null then
    raise exception 'Sign in before enabling push notifications';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'Unsupported push platform';
  end if;
  if char_length(trim(coalesce(p_expo_push_token, ''))) < 10
    or char_length(trim(coalesce(p_device_id, ''))) < 10
  then
    raise exception 'Invalid push token registration';
  end if;

  delete from public.device_push_tokens
  where expo_push_token = p_expo_push_token
     or (user_id = auth.uid() and device_id = p_device_id);

  insert into public.device_push_tokens(
    user_id, expo_push_token, platform, device_id, enabled, last_seen_at
  )
  values(
    auth.uid(), p_expo_push_token, p_platform, p_device_id, true, now()
  )
  returning * into registered;

  return registered;
end;
$$;

revoke all on function public.register_device_push_token(text, text, text) from public;
grant execute on function public.register_device_push_token(text, text, text) to authenticated;

create or replace function public.notify_nearby_match_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_name text;
  match_format text;
  match_mode text;
begin
  select profile.display_name
  into sender_name
  from public.profiles profile
  where profile.id = new.sender_id;

  match_format := case
    when new.match_payload->>'matchType' = 'singles' then 'Singles'
    else 'Doubles'
  end;
  match_mode := case
    when new.match_payload->>'mode' = 'ranked' then 'ranked'
    else 'casual'
  end;

  insert into public.user_notifications(user_id, kind, title, body, data)
  values(
    new.recipient_id,
    'match_invite',
    'New match invitation',
    format('%s invited you to a %s %s match.', coalesce(sender_name, 'A nearby player'), lower(match_format), match_mode),
    jsonb_build_object(
      'inviteId', new.id,
      'senderId', new.sender_id,
      'matchType', lower(match_format),
      'mode', match_mode,
      'expiresAt', new.created_at + interval '1 minute',
      'dedupeKey', 'nearby-invite:' || new.id::text
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_nearby_match_invite_after_insert on public.match_invites;
create trigger notify_nearby_match_invite_after_insert
after insert on public.match_invites
for each row
execute function public.notify_nearby_match_invite();

create or replace function public.notify_nearby_match_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_name text;
begin
  if new.status <> 'accepted' or old.status is not distinct from new.status then
    return new;
  end if;

  select profile.display_name
  into recipient_name
  from public.profiles profile
  where profile.id = new.recipient_id;

  insert into public.user_notifications(user_id, kind, title, body, data)
  values(
    new.sender_id,
    'match_invite_response',
    'Match invitation accepted',
    format('%s accepted your invitation. Your match is on.', coalesce(recipient_name, 'A nearby player')),
    jsonb_build_object(
      'inviteId', new.id,
      'recipientId', new.recipient_id,
      'status', new.status,
      'dedupeKey', 'nearby-accepted:' || new.id::text
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_nearby_match_response_after_update on public.match_invites;
create trigger notify_nearby_match_response_after_update
after update of status on public.match_invites
for each row
execute function public.notify_nearby_match_response();

create or replace function public.notify_competitive_match_found()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_name text;
  matched_name text;
  request_label text;
begin
  if new.status <> 'matched'
    or new.matched_user_id is null
    or old.status is not distinct from new.status
  then
    return new;
  end if;

  select profile.display_name
  into creator_name
  from public.profiles profile
  where profile.id = new.creator_id;

  select profile.display_name
  into matched_name
  from public.profiles profile
  where profile.id = new.matched_user_id;

  request_label := case new.kind
    when 'partner' then 'partner request'
    when 'opponent' then 'opponent request'
    when 'substitute' then 'substitute request'
    else 'match request'
  end;

  insert into public.user_notifications(user_id, kind, title, body, data)
  values
    (
      new.creator_id,
      'match_found',
      'Match found',
      format('%s matched your %s in %s.', coalesce(matched_name, 'A player'), request_label, new.area),
      jsonb_build_object(
        'postId', new.id,
        'matchedUserId', new.matched_user_id,
        'kind', new.kind,
        'format', new.format,
        'startsAt', new.starts_at,
        'dedupeKey', 'match-found:creator:' || new.id::text
      )
    ),
    (
      new.matched_user_id,
      'match_found',
      'You are matched',
      format('You joined %s''s %s in %s.', coalesce(creator_name, 'a player'), request_label, new.area),
      jsonb_build_object(
        'postId', new.id,
        'creatorId', new.creator_id,
        'kind', new.kind,
        'format', new.format,
        'startsAt', new.starts_at,
        'dedupeKey', 'match-found:matched:' || new.id::text
      )
    )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_competitive_match_found_after_update on public.matchmaking_posts;
create trigger notify_competitive_match_found_after_update
after update of status, matched_user_id on public.matchmaking_posts
for each row
execute function public.notify_competitive_match_found();

create or replace function public.notify_open_play_organizer_match_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_user uuid;
  session_name text;
  court_number integer;
begin
  select session.organizer_id, session.name, court.court_number
  into organizer_user, session_name, court_number
  from public.open_play_sessions session
  join public.open_play_courts court on court.id = new.session_court_id
  where session.id = new.session_id;

  if organizer_user is null or exists (
    select 1
    from public.open_play_match_players lineup
    join public.open_play_players player on player.id = lineup.player_id
    where lineup.match_id = new.match_id
      and player.user_id = organizer_user
  ) then
    return new;
  end if;

  insert into public.user_notifications(user_id, session_id, kind, title, body, data)
  values(
    organizer_user,
    new.session_id,
    'organizer_match',
    'Match started',
    format('Court %s is live for %s.', court_number, session_name),
    jsonb_build_object(
      'sessionId', new.session_id,
      'matchId', new.match_id,
      'court', court_number,
      'event', 'started',
      'dedupeKey', 'organizer-started:' || new.match_id
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_open_play_organizer_match_started_after_decision on public.open_play_rotation_decisions;
create trigger notify_open_play_organizer_match_started_after_decision
after insert on public.open_play_rotation_decisions
for each row
execute function public.notify_open_play_organizer_match_started();

create or replace function public.notify_open_play_organizer_match_finished()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_user uuid;
  session_name text;
  court_number integer;
begin
  if new.status <> 'completed' or old.status is not distinct from new.status then
    return new;
  end if;

  select session.organizer_id, session.name, court.court_number
  into organizer_user, session_name, court_number
  from public.open_play_sessions session
  join public.open_play_courts court on court.id = new.session_court_id
  where session.id = new.session_id;

  if organizer_user is null or exists (
    select 1
    from public.open_play_match_players lineup
    join public.open_play_players player on player.id = lineup.player_id
    where lineup.match_id = new.id
      and player.user_id = organizer_user
  ) then
    return new;
  end if;

  insert into public.user_notifications(user_id, session_id, kind, title, body, data)
  values(
    organizer_user,
    new.session_id,
    'organizer_match',
    'Match finished',
    format('Court %s at %s finished %s–%s.', court_number, session_name, new.home_score, new.away_score),
    jsonb_build_object(
      'sessionId', new.session_id,
      'matchId', new.id,
      'court', court_number,
      'event', 'finished',
      'dedupeKey', 'organizer-finished:' || new.id
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_open_play_organizer_match_finished_after_update on public.open_play_matches;
create trigger notify_open_play_organizer_match_finished_after_update
after update of home_score, away_score, status on public.open_play_matches
for each row
execute function public.notify_open_play_organizer_match_finished();

revoke all on function public.notify_nearby_match_invite() from public;
revoke all on function public.notify_nearby_match_response() from public;
revoke all on function public.notify_competitive_match_found() from public;
revoke all on function public.notify_open_play_organizer_match_started() from public;
revoke all on function public.notify_open_play_organizer_match_finished() from public;

notify pgrst, 'reload schema';
