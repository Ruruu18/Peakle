-- Open-play setup must use real venue courts and share the same availability
-- rules as ordinary court bookings.

create or replace function public.booking_court_is_available(
  p_court_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_booking uuid default null
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.bookings booking
    where booking.court_id = p_court_id
      and booking.id is distinct from p_exclude_booking
      and booking.status in ('pending', 'confirmed')
      and tstzrange(booking.starts_at, booking.ends_at, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  ) and not exists (
    select 1
    from public.court_blackouts blackout
    join public.courts court on court.id = p_court_id
    where blackout.venue_id = court.venue_id
      and (blackout.court_id is null or blackout.court_id = p_court_id)
      and tstzrange(blackout.starts_at, blackout.ends_at, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  ) and not exists (
    select 1
    from public.court_waitlist hold
    where hold.court_id = p_court_id
      and hold.status = 'offered'
      and hold.offer_expires_at > now()
      and hold.user_id is distinct from auth.uid()
      and tstzrange(hold.starts_at, hold.ends_at, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  ) and not exists (
    select 1
    from public.open_play_courts session_court
    join public.open_play_sessions session on session.id = session_court.session_id
    where session_court.venue_court_id = p_court_id
      and session.status = 'active'
      and tstzrange(session.scheduled_start, session.scheduled_end, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  )
$$;

create or replace function public.get_court_availability(
  p_court_ids text[],
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns table(court_id text, available boolean, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    court.id,
    court.active
      and venue.active
      and public.booking_court_is_available(court.id, p_starts_at, p_ends_at, null),
    case
      when not court.active or not venue.active then 'Court unavailable'
      when exists (
        select 1
        from public.court_blackouts blackout
        where blackout.venue_id = court.venue_id
          and (blackout.court_id is null or blackout.court_id = court.id)
          and tstzrange(blackout.starts_at, blackout.ends_at, '[)')
            && tstzrange(p_starts_at, p_ends_at, '[)')
      ) then 'Venue blackout'
      when exists (
        select 1
        from public.bookings booking
        where booking.court_id = court.id
          and booking.status in ('pending', 'confirmed')
          and tstzrange(booking.starts_at, booking.ends_at, '[)')
            && tstzrange(p_starts_at, p_ends_at, '[)')
      ) then 'Booked'
      when exists (
        select 1
        from public.open_play_courts session_court
        join public.open_play_sessions session on session.id = session_court.session_id
        where session_court.venue_court_id = court.id
          and session.status = 'active'
          and tstzrange(session.scheduled_start, session.scheduled_end, '[)')
            && tstzrange(p_starts_at, p_ends_at, '[)')
      ) then 'Open play'
      when exists (
        select 1
        from public.court_waitlist hold
        where hold.court_id = court.id
          and hold.status = 'offered'
          and hold.offer_expires_at > now()
          and hold.user_id is distinct from auth.uid()
          and tstzrange(hold.starts_at, hold.ends_at, '[)')
            && tstzrange(p_starts_at, p_ends_at, '[)')
      ) then 'Waitlist hold'
      else null
    end
  from public.courts court
  join public.venues venue on venue.id = court.venue_id
  where court.id = any(p_court_ids)
$$;

create or replace function public.get_court_schedule(
  p_court_ids text[],
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns table(court_id text, starts_at timestamptz, ends_at timestamptz, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select booking.court_id, booking.starts_at, booking.ends_at, 'Booked'::text
  from public.bookings booking
  where booking.court_id = any(p_court_ids)
    and booking.status in ('pending', 'confirmed')
    and tstzrange(booking.starts_at, booking.ends_at, '[)')
      && tstzrange(p_starts_at, p_ends_at, '[)')
  union all
  select court.id, blackout.starts_at, blackout.ends_at, coalesce(blackout.reason, 'Venue blackout')
  from public.court_blackouts blackout
  join public.courts court on court.venue_id = blackout.venue_id
    and (blackout.court_id is null or blackout.court_id = court.id)
  where court.id = any(p_court_ids)
    and tstzrange(blackout.starts_at, blackout.ends_at, '[)')
      && tstzrange(p_starts_at, p_ends_at, '[)')
  union all
  select hold.court_id, hold.starts_at, hold.ends_at, 'Waitlist hold'::text
  from public.court_waitlist hold
  where hold.court_id = any(p_court_ids)
    and hold.status = 'offered'
    and hold.offer_expires_at > now()
    and hold.user_id is distinct from auth.uid()
    and tstzrange(hold.starts_at, hold.ends_at, '[)')
      && tstzrange(p_starts_at, p_ends_at, '[)')
  union all
  select session_court.venue_court_id, session.scheduled_start, session.scheduled_end, 'Open play'::text
  from public.open_play_courts session_court
  join public.open_play_sessions session on session.id = session_court.session_id
  where session_court.venue_court_id = any(p_court_ids)
    and session.status = 'active'
    and tstzrange(session.scheduled_start, session.scheduled_end, '[)')
      && tstzrange(p_starts_at, p_ends_at, '[)')
$$;

drop function if exists public.create_open_play_session(
  text, text, integer, integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
);

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
set search_path = ''
as $$
declare
  created public.open_play_sessions;
  generated_code text;
  selected_court_id text;
  selected_court_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_active_organizer_entitlement(auth.uid()) then raise exception 'An active Organizer Pass is required'; end if;
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

revoke all on function public.booking_court_is_available(text, timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_court_availability(text[], timestamptz, timestamptz) from public;
revoke all on function public.get_court_schedule(text[], timestamptz, timestamptz) from public;
revoke all on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
) from public;

grant execute on function public.get_court_availability(text[], timestamptz, timestamptz) to authenticated;
grant execute on function public.get_court_schedule(text[], timestamptz, timestamptz) to authenticated;
grant execute on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
) to authenticated;
