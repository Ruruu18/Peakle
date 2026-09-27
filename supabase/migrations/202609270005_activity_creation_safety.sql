begin;

-- A durable ledger prevents cancel/delete/recreate from resetting the limits.
-- Only successful inserts consume quota; the ledger and activity commit together.
create schema if not exists app_private;
create table app_private.activity_creation_log (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('scheduled', 'open_play')),
  resource_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  fingerprint text,
  payload jsonb,
  primary key (kind, resource_id)
);
revoke all on app_private.activity_creation_log from public, anon, authenticated;
create index activity_creation_actor_time_idx
  on app_private.activity_creation_log(actor_id, kind, created_at desc);
create index activity_creation_retry_idx
  on app_private.activity_creation_log(actor_id, kind, fingerprint)
  where fingerprint is not null;

-- Count recent activity from before this migration too.
insert into app_private.activity_creation_log(actor_id, kind, resource_id, created_at)
select host_id, 'scheduled', id::text, created_at from public.scheduled_games
where created_at > now() - interval '24 hours';
insert into app_private.activity_creation_log(actor_id, kind, resource_id, created_at)
select organizer_id, 'open_play', id, created_at from public.open_play_sessions
where created_at > now() - interval '24 hours';

create index if not exists scheduled_games_host_upcoming_idx
  on public.scheduled_games(host_id, ends_at) where status = 'scheduled';
create index if not exists open_play_organizer_upcoming_idx
  on public.open_play_sessions(organizer_id, scheduled_end) where status in ('draft', 'active');

create function app_private.guard_activity_creation()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  activity_kind text := case when tg_table_name = 'scheduled_games' then 'scheduled' else 'open_play' end;
  daily_limit integer := case when tg_table_name = 'scheduled_games' then 10 else 30 end;
  upcoming_limit integer := case when tg_table_name = 'scheduled_games' then 20 else 100 end;
  upcoming_count integer;
  recent_count integer;
  last_created timestamptz;
begin
  -- Trusted maintenance remains possible; client requests always need a user.
  if actor is null and coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if actor is null then raise exception 'Sign in to host an activity.'; end if;

  if activity_kind = 'open_play' then
    if tg_op = 'UPDATE' then
      if new.organizer_id is distinct from old.organizer_id or new.venue_id is distinct from old.venue_id then
        raise exception 'Create a new session to change its organizer or venue.';
      end if;
      if new.scheduled_start is distinct from old.scheduled_start or new.scheduled_end is distinct from old.scheduled_end then
        raise exception 'Create a new session to change its schedule.';
      end if;
      if old.status in ('completed', 'cancelled') and new.status in ('draft', 'active') then
        raise exception 'A finished or cancelled session cannot be reopened. Create a new session instead.';
      end if;
      return new;
    end if;
    if new.organizer_id is distinct from actor
       or not (public.can_manage_venue(new.venue_id) or public.is_platform_admin()) then
      raise exception 'Only this venue''s owner, manager, or a platform admin can publish open play.';
    end if;
    if not public.is_verified_active_venue(new.venue_id) then
      raise exception 'Choose a verified active venue.';
    end if;
    if char_length(btrim(new.name)) not between 3 and 80
       or char_length(coalesce(new.rules, '')) > 1000
       or char_length(coalesce(new.cancellation_policy, '')) > 1000 then
      raise exception 'Use a session name of 3–80 characters and rules and cancellation policy of at most 1,000 characters each.';
    end if;
    if new.scheduled_start is null or new.scheduled_end is null
       or new.scheduled_start <= now() or new.scheduled_start > now() + interval '180 days'
       or new.scheduled_end <= new.scheduled_start
       or new.scheduled_end > new.scheduled_start + interval '12 hours' then
      raise exception 'Choose a future session within 180 days, lasting at most 12 hours.';
    end if;
  elsif new.host_id is distinct from actor then
    raise exception 'You can only create activities for your own account.';
  end if;

  -- All entry points, including legacy RPCs and direct inserts, share this lock.
  perform pg_advisory_xact_lock(hashtextextended('activity-create:' || actor::text || ':' || activity_kind, 0));
  select count(*), max(created_at) into recent_count, last_created
  from app_private.activity_creation_log
  where actor_id = actor and kind = activity_kind and created_at > clock_timestamp() - interval '24 hours';
  if last_created > clock_timestamp() - interval '30 seconds' then
    raise exception 'Please wait 30 seconds before creating another activity.';
  end if;
  if recent_count >= daily_limit then
    raise exception 'You can create up to % activities in 24 hours. Please try again later.', daily_limit;
  end if;
  if activity_kind = 'scheduled' then
    select count(*) into upcoming_count from public.scheduled_games
    where host_id = actor and status = 'scheduled' and ends_at > now();
  else
    select count(*) into upcoming_count from public.open_play_sessions
    where organizer_id = actor and status in ('draft', 'active') and scheduled_end > now();
  end if;
  if upcoming_count >= upcoming_limit then
    raise exception 'You can host up to % upcoming activities. Finish or cancel an existing activity first.', upcoming_limit;
  end if;
  new.created_at := clock_timestamp();
  insert into app_private.activity_creation_log(actor_id, kind, resource_id, created_at)
  values (actor, activity_kind, new.id::text, new.created_at);
  return new;
end;
$$;
revoke all on function app_private.guard_activity_creation() from public, anon, authenticated;

create trigger guard_scheduled_activity_creation before insert on public.scheduled_games
for each row execute function app_private.guard_activity_creation();
create trigger guard_open_play_creation before insert or update of organizer_id, venue_id, scheduled_start, scheduled_end, status on public.open_play_sessions
for each row execute function app_private.guard_activity_creation();

drop policy if exists "organizers create sessions" on public.open_play_sessions;
create policy "organizers create sessions" on public.open_play_sessions for insert to authenticated
with check (
  organizer_id = auth.uid() and status in ('draft', 'active')
  and public.is_verified_active_venue(venue_id)
  and (public.can_manage_venue(venue_id) or public.is_platform_admin())
);

-- Identical submissions, including retries after a lost response, return the
-- original record before quota is checked. The per-account lock makes this
-- atomic for simultaneous requests and avoids duplicate invitations.
create function app_private.find_activity_creation(p_kind text, p_payload jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare result text;
begin
  if auth.uid() is null then raise exception 'Sign in to host an activity.'; end if;
  if pg_column_size(p_payload) > 16384 then raise exception 'The activity details are too long.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('activity-create:' || auth.uid()::text || ':' || p_kind, 0));
  select resource_id into result from app_private.activity_creation_log
  where actor_id = auth.uid() and kind = p_kind
    and fingerprint = md5(p_payload::text) and payload = p_payload
  order by created_at desc limit 1;
  return result;
end;
$$;
revoke all on function app_private.find_activity_creation(text, jsonb) from public, anon, authenticated;

-- Preserve the current validation, roster and notification implementation;
-- remove client execution of the implementation and wrap its public entry point.
alter function public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[], double precision, double precision)
  set schema app_private;
alter function app_private.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[], double precision, double precision)
  rename to create_scheduled_activity_impl;
revoke all on function app_private.create_scheduled_activity_impl(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[], double precision, double precision)
  from public, anon, authenticated;

create function public.create_scheduled_activity(
  p_activity_kind text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_match_type text, p_mode text, p_visibility text, p_capacity integer, p_court_label text,
  p_court_area text default null, p_venue_id text default null, p_court_id text default null,
  p_notes text default null, p_invitee_ids uuid[] default '{}',
  p_latitude double precision default null, p_longitude double precision default null
)
returns public.scheduled_games
language plpgsql security definer set search_path = ''
as $$
declare
  creation_payload jsonb;
  existing_id text;
  result public.scheduled_games;
begin
  if coalesce(cardinality(p_invitee_ids), 0) > 15 then raise exception 'Invite at most 15 players.'; end if;
  -- Coordinates are best-effort enrichment and may change between retries.
  creation_payload := jsonb_build_array(p_activity_kind, btrim(p_title), p_starts_at, p_ends_at,
    p_match_type, p_mode, p_visibility, p_capacity, btrim(p_court_label), btrim(p_court_area),
    p_venue_id, p_court_id, nullif(btrim(p_notes), ''),
    array(select distinct id from unnest(p_invitee_ids) id where id is not null order by id));
  existing_id := app_private.find_activity_creation('scheduled', creation_payload);
  if existing_id is not null then
    select * into result from public.scheduled_games where id = existing_id::uuid and host_id = auth.uid();
    if result.id is null then raise exception 'This activity was removed. Choose a new schedule to create another.'; end if;
    return result;
  end if;
  if p_venue_id is not null and not public.is_verified_active_venue(p_venue_id) then
    raise exception 'Choose a verified active venue or enter your own court.';
  end if;
  if p_court_id is not null and not exists (
    select 1 from public.courts where id = p_court_id and venue_id = p_venue_id and active
  ) then raise exception 'Choose an active court at the selected venue.'; end if;
  result := app_private.create_scheduled_activity_impl(
    p_activity_kind, p_title, p_starts_at, p_ends_at, p_match_type, p_mode, p_visibility,
    p_capacity, p_court_label, p_court_area, p_venue_id, p_court_id, p_notes, p_invitee_ids,
    p_latitude, p_longitude);
  update app_private.activity_creation_log set payload = creation_payload, fingerprint = md5(creation_payload::text)
  where actor_id = auth.uid() and kind = 'scheduled' and resource_id = result.id::text;
  return result;
end;
$$;
revoke all on function public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[], double precision, double precision) from public, anon;
grant execute on function public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[], double precision, double precision) to authenticated;

-- Old clients receive exactly the same protections and retry behavior.
create or replace function public.create_scheduled_game(
  p_title text, p_starts_at timestamptz, p_ends_at timestamptz, p_match_type text,
  p_mode text, p_visibility text, p_capacity integer, p_court_label text,
  p_court_area text default null, p_venue_id text default null, p_court_id text default null,
  p_notes text default null, p_invitee_ids uuid[] default '{}'
)
returns public.scheduled_games
language sql security invoker set search_path = ''
as $$
  select * from public.create_scheduled_activity('game', p_title, p_starts_at, p_ends_at,
    p_match_type, p_mode, p_visibility, p_capacity, p_court_label, p_court_area,
    p_venue_id, p_court_id, p_notes, p_invitee_ids)
$$;

-- The legacy court-reservation entry point must use the same lock order.
create or replace function public.create_open_play_session(
  p_name text,
  p_venue_id text,
  p_court_ids text[],
  p_capacity integer,
  p_visibility text,
  p_approval_mode text,
  p_skill_min numeric,
  p_skill_max numeric,
  p_fee_amount numeric,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_rules text,
  p_cancellation_policy text,
  p_match_format text,
  p_average_match_minutes integer,
  p_max_consecutive_games integer,
  p_rest_minutes integer
)
returns public.open_play_sessions
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  created public.open_play_sessions;
  generated_code text;
  selected_court_id text;
  selected_court_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.can_manage_venue(p_venue_id) or public.is_platform_admin()) then
    raise exception 'Only this venue''s owner, manager, or a platform admin can publish open play.';
  end if;
  -- Keep account locks before court locks, including calls from older clients.
  perform pg_advisory_xact_lock(hashtextextended('activity-create:' || auth.uid()::text || ':open_play', 0));
  if char_length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Session name is required'; end if;
  if cardinality(p_court_ids) is null or cardinality(p_court_ids) not between 1 and 50 then raise exception 'Select at least one available court'; end if;
  if cardinality(array(select distinct unnest(p_court_ids))) <> cardinality(p_court_ids) then raise exception 'A court was selected twice'; end if;
  if p_capacity not between 4 and 200 then raise exception 'Capacity must be between 4 and 200'; end if;
  if p_visibility not in ('public', 'private', 'invite_only') then raise exception 'Choose a valid visibility'; end if;
  if p_approval_mode not in ('automatic', 'manual') then raise exception 'Choose a valid approval mode'; end if;
  if p_match_format not in ('singles', 'doubles') then raise exception 'Choose singles or doubles'; end if;
  if p_average_match_minutes not between 5 and 90 then raise exception 'Average match time must be between 5 and 90 minutes'; end if;
  if p_max_consecutive_games not between 0 and 10 then raise exception 'Consecutive-game limit must be between 0 and 10'; end if;
  if p_rest_minutes not between 0 and 120 then raise exception 'Rest time must be between 0 and 120 minutes'; end if;
  if p_scheduled_start is null or p_scheduled_end is null or p_scheduled_end <= p_scheduled_start then raise exception 'Choose a valid session schedule'; end if;
  if p_scheduled_end <= now() then raise exception 'The session must end in the future'; end if;
  if p_fee_amount is null or p_fee_amount < 0 then raise exception 'Fee cannot be negative'; end if;
  if p_skill_min is not null and (p_skill_min < 1 or p_skill_min > 5.5) then raise exception 'Minimum skill must be between 1.0 and 5.5'; end if;
  if p_skill_max is not null and (p_skill_max < 1 or p_skill_max > 5.5) then raise exception 'Maximum skill must be between 1.0 and 5.5'; end if;
  if p_skill_min is not null and p_skill_max is not null and p_skill_min > p_skill_max then raise exception 'Minimum skill cannot exceed maximum skill'; end if;
  if not exists (
    select 1 from public.venues
    where id = p_venue_id and active and verification_status = 'verified'
  ) then raise exception 'Choose a verified active venue'; end if;

  select count(*)
  into selected_court_count
  from public.courts
  where id = any(p_court_ids)
    and venue_id = p_venue_id
    and active;
  if selected_court_count <> cardinality(p_court_ids) then
    raise exception 'Every selected court must be active at this center';
  end if;

  for selected_court_id in
    select selected.court_id
    from unnest(p_court_ids) as selected(court_id)
    order by selected.court_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(selected_court_id, 0));
  end loop;

  for selected_court_id in
    select selected.court_id
    from unnest(p_court_ids) as selected(court_id)
  loop
    if not public.booking_court_is_available(selected_court_id, p_scheduled_start, p_scheduled_end, null) then
      raise exception '% is no longer available',
        (select name from public.courts where id = selected_court_id);
    end if;
  end loop;

  loop
    generated_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists (
      select 1 from public.open_play_sessions where session_code = generated_code
    );
  end loop;

  insert into public.open_play_sessions (
    id, organizer_id, venue_id, name, status, court_count, session_code,
    visibility, approval_mode, capacity, skill_min, skill_max, fee_amount,
    scheduled_start, scheduled_end, rules, cancellation_policy,
    match_format, average_match_minutes, max_consecutive_games, rest_minutes
  ) values (
    gen_random_uuid()::text, auth.uid(), p_venue_id, trim(p_name), 'active',
    cardinality(p_court_ids), generated_code, p_visibility, p_approval_mode,
    p_capacity, p_skill_min, p_skill_max, p_fee_amount, p_scheduled_start,
    p_scheduled_end,
    coalesce(nullif(trim(p_rules), ''), 'Doubles · First to 11 · Win by 2'),
    coalesce(nullif(trim(p_cancellation_policy), ''), 'Cancel before the session starts so a waitlisted player can take your place.'),
    p_match_format, p_average_match_minutes, p_max_consecutive_games, p_rest_minutes
  )
  returning * into created;

  insert into public.open_play_courts (
    id, session_id, court_number, venue_court_id
  )
  select
    created.id || '-court-' || selected.position,
    created.id,
    selected.position::integer,
    selected.court_id
  from unnest(p_court_ids) with ordinality as selected(court_id, position);

  return created;
end
$$;

revoke all on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
) from public;
grant execute on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
) to authenticated;


alter function public.create_open_play_session(text, text, text[], integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer, text[])
  rename to create_open_play_session_impl;
alter function public.create_open_play_session_impl(text, text, text[], integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer, text[])
  set schema app_private;
revoke all on function app_private.create_open_play_session_impl(text, text, text[], integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer, text[])
  from public, anon, authenticated;

create function public.create_open_play_session(
  p_name text, p_venue_id text, p_court_ids text[], p_capacity integer, p_visibility text,
  p_approval_mode text, p_skill_min numeric, p_skill_max numeric, p_fee_amount numeric,
  p_scheduled_start timestamptz, p_scheduled_end timestamptz, p_rules text,
  p_cancellation_policy text, p_match_format text, p_average_match_minutes integer,
  p_max_consecutive_games integer, p_rest_minutes integer, p_court_formats text[]
)
returns public.open_play_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  creation_payload jsonb;
  existing_id text;
  result public.open_play_sessions;
begin
  if auth.uid() is null then raise exception 'Sign in to host an activity.'; end if;
  if not (public.can_manage_venue(p_venue_id) or public.is_platform_admin()) then
    raise exception 'Only this venue''s owner, manager, or a platform admin can publish open play.';
  end if;
  if coalesce(cardinality(p_court_ids), 0) not between 1 and 50
     or cardinality(p_court_formats) is distinct from cardinality(p_court_ids) then
    raise exception 'Select 1–50 courts and a format for each court.';
  end if;
  creation_payload := jsonb_build_array(btrim(p_name), p_venue_id, p_court_ids, p_capacity, p_visibility,
    p_approval_mode, p_skill_min, p_skill_max, p_fee_amount, p_scheduled_start, p_scheduled_end,
    btrim(p_rules), btrim(p_cancellation_policy), p_match_format, p_average_match_minutes,
    p_max_consecutive_games, p_rest_minutes, p_court_formats);
  existing_id := app_private.find_activity_creation('open_play', creation_payload);
  if existing_id is not null then
    select * into result from public.open_play_sessions where id = existing_id and organizer_id = auth.uid();
    if result.id is null then raise exception 'This session was removed. Choose a new schedule to publish another.'; end if;
    return result;
  end if;
  result := app_private.create_open_play_session_impl(p_name, p_venue_id, p_court_ids, p_capacity,
    p_visibility, p_approval_mode, p_skill_min, p_skill_max, p_fee_amount, p_scheduled_start,
    p_scheduled_end, p_rules, p_cancellation_policy, p_match_format, p_average_match_minutes,
    p_max_consecutive_games, p_rest_minutes, p_court_formats);
  update app_private.activity_creation_log set payload = creation_payload, fingerprint = md5(creation_payload::text)
  where actor_id = auth.uid() and kind = 'open_play' and resource_id = result.id;
  return result;
end;
$$;
revoke all on function public.create_open_play_session(text, text, text[], integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer, text[]) from public, anon;
grant execute on function public.create_open_play_session(text, text, text[], integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer, text[]) to authenticated;

-- A separate, paginated source for My schedule. Public discovery can never
-- consume this query's slots. SECURITY INVOKER preserves table RLS.
create function public.list_my_scheduled_games(p_from timestamptz, p_to timestamptz)
returns setof public.scheduled_games
language sql stable security invoker set search_path = ''
as $$
  select game.* from public.scheduled_games game
  where game.ends_at >= p_from and game.starts_at < p_to
    and (game.host_id = auth.uid() or exists (
      select 1 from public.scheduled_game_players player
      where player.game_id = game.id and player.user_id = auth.uid()
    ))
$$;
revoke all on function public.list_my_scheduled_games(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_my_scheduled_games(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
