-- Mixed open play keeps one simple organizer session while assigning a
-- concrete singles/doubles format to each court.

alter table public.open_play_sessions
  drop constraint if exists open_play_sessions_match_format_check;

alter table public.open_play_sessions
  add constraint open_play_sessions_match_format_check
  check (match_format in ('singles', 'doubles', 'mixed'));

alter table public.open_play_courts
  add column if not exists match_format text not null default 'doubles';

update public.open_play_courts court
set match_format = case when session.match_format = 'singles' then 'singles' else 'doubles' end
from public.open_play_sessions session
where session.id = court.session_id;

alter table public.open_play_courts
  drop constraint if exists open_play_courts_match_format_check;

alter table public.open_play_courts
  add constraint open_play_courts_match_format_check
  check (match_format in ('singles', 'doubles'));

drop function if exists public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer, text[]
);

create function public.create_open_play_session(
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
  p_rest_minutes integer,
  p_court_formats text[]
)
returns public.open_play_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.open_play_sessions;
begin
  if p_match_format not in ('singles', 'doubles', 'mixed') then
    raise exception 'Choose doubles, singles, or both';
  end if;
  if cardinality(p_court_formats) is distinct from cardinality(p_court_ids) then
    raise exception 'Every selected court needs a match format';
  end if;
  if exists (
    select 1 from unnest(p_court_formats) selected(format)
    where selected.format not in ('singles', 'doubles')
  ) then
    raise exception 'Each court must use singles or doubles';
  end if;
  if p_match_format <> 'mixed' and exists (
    select 1 from unnest(p_court_formats) selected(format)
    where selected.format <> p_match_format
  ) then
    raise exception 'Court formats must match the session format';
  end if;

  created := public.create_open_play_session(
    p_name,
    p_venue_id,
    p_court_ids,
    p_capacity,
    p_visibility,
    p_approval_mode,
    p_skill_min,
    p_skill_max,
    p_fee_amount,
    p_scheduled_start,
    p_scheduled_end,
    p_rules,
    p_cancellation_policy,
    case when p_match_format = 'mixed' then 'doubles' else p_match_format end,
    p_average_match_minutes,
    p_max_consecutive_games,
    p_rest_minutes
  );

  update public.open_play_sessions
  set match_format = p_match_format
  where id = created.id;

  update public.open_play_courts court
  set match_format = selected.format
  from unnest(p_court_formats) with ordinality selected(format, position)
  where court.session_id = created.id
    and court.court_number = selected.position;

  select * into created
  from public.open_play_sessions
  where id = created.id;

  return created;
end
$$;

revoke all on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer, text[]
) from public;

grant execute on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer, text[]
) to authenticated;

create or replace function public.assign_fair_play_match(
  p_session_id text,
  p_court_id text,
  p_match_id text,
  p_player_ids text[],
  p_scorer_player_id text,
  p_explanation jsonb,
  p_recommended_ids text[],
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  court_row public.open_play_courts;
  expected_count integer;
  selected_count integer;
  is_override boolean;
begin
  select * into session_row
  from public.open_play_sessions
  where id = p_session_id
  for update;

  if session_row.id is null or session_row.status <> 'active' then
    raise exception 'Active session not found';
  end if;
  if not public.owns_open_play(session_row.id) then
    raise exception 'Session staff permission required';
  end if;

  select * into court_row
  from public.open_play_courts
  where id = p_court_id and session_id = p_session_id
  for update;

  if court_row.id is null then
    raise exception 'Court does not belong to this session';
  end if;

  expected_count := case when court_row.match_format = 'singles' then 2 else 4 end;
  if cardinality(p_player_ids) <> expected_count
    or cardinality(p_recommended_ids) <> expected_count then
    raise exception 'The % lineup needs % players', court_row.match_format, expected_count;
  end if;

  select count(distinct selected.id)
  into selected_count
  from unnest(p_player_ids) selected(id);

  if selected_count <> expected_count then
    raise exception 'Each assigned player must be unique';
  end if;
  if not (p_scorer_player_id = any(p_player_ids)) then
    raise exception 'The scorer must be in the lineup';
  end if;
  if exists (
    select 1 from public.open_play_matches
    where session_court_id = p_court_id and status = 'live'
  ) then
    raise exception 'This court already has a live match';
  end if;

  perform 1
  from public.open_play_players
  where session_id = p_session_id and id = any(p_player_ids)
  for update;

  select count(*)
  into selected_count
  from public.open_play_players
  where session_id = p_session_id
    and id = any(p_player_ids)
    and registration_status = 'approved'
    and checked_in_at is not null
    and departed_at is null
    and status = 'waiting'
    and queue_position is not null;

  if selected_count <> expected_count then
    raise exception 'One or more players are no longer available';
  end if;

  is_override := p_player_ids <> p_recommended_ids;
  if is_override and char_length(trim(coalesce(p_override_reason, ''))) < 8 then
    raise exception 'Explain the lineup override in at least 8 characters';
  end if;

  insert into public.open_play_matches(
    id, session_id, session_court_id, scorer_player_id, status
  ) values (
    p_match_id, p_session_id, p_court_id, p_scorer_player_id, 'live'
  );

  insert into public.open_play_match_players(match_id, player_id, side, position)
  select
    p_match_id,
    player_id,
    case when expected_count = 2 then ordinal - 1 when ordinal <= 2 then 0 else 1 end,
    case when expected_count = 2 then 0 when ordinal in (1, 3) then 0 else 1 end
  from unnest(p_player_ids) with ordinality selected(player_id, ordinal);

  update public.open_play_players
  set status = 'playing', queue_position = null
  where session_id = p_session_id and id = any(p_player_ids);

  update public.open_play_players
  set consecutive_games = 0
  where session_id = p_session_id
    and status = 'waiting'
    and queue_position is not null
    and not (id = any(p_player_ids));

  with ordered as (
    select
      id,
      row_number() over(order by queue_position, waiting_since, joined_at) - 1 as next_position
    from public.open_play_players
    where session_id = p_session_id
      and status = 'waiting'
      and queue_position is not null
  )
  update public.open_play_players player
  set queue_position = ordered.next_position
  from ordered
  where player.id = ordered.id;

  insert into public.open_play_rotation_decisions(
    session_id,
    session_court_id,
    match_id,
    selected_player_ids,
    recommended_player_ids,
    explanation,
    overridden,
    override_reason,
    decided_by
  ) values (
    p_session_id,
    p_court_id,
    p_match_id,
    p_player_ids,
    p_recommended_ids,
    coalesce(p_explanation, '{}'::jsonb),
    is_override,
    nullif(trim(p_override_reason), ''),
    auth.uid()
  );

  return jsonb_build_object(
    'match_id', p_match_id,
    'match_format', court_row.match_format,
    'overridden', is_override,
    'assigned_at', now()
  );
end
$$;

create or replace function public.list_discoverable_open_play_sessions()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', session.id,
    'name', session.name,
    'visibility', session.visibility,
    'approval_mode', session.approval_mode,
    'capacity', session.capacity,
    'skill_min', session.skill_min,
    'skill_max', session.skill_max,
    'fee_amount', session.fee_amount,
    'currency', session.currency,
    'scheduled_start', session.scheduled_start,
    'scheduled_end', session.scheduled_end,
    'rules', session.rules,
    'match_format', session.match_format,
    'average_match_minutes', session.average_match_minutes,
    'max_consecutive_games', session.max_consecutive_games,
    'rest_minutes', session.rest_minutes,
    'organizer', jsonb_build_object(
      'id', organizer.id,
      'name', organizer.display_name,
      'avatar_url', organizer.avatar_url
    ),
    'venue', jsonb_build_object(
      'id', venue.id,
      'name', venue.name,
      'area', venue.area,
      'address', venue.address,
      'latitude', venue.latitude,
      'longitude', venue.longitude,
      'verified', venue.verification_status = 'verified'
    ),
    'registered_count', (
      select count(*)
      from public.open_play_players player
      where player.session_id = session.id
        and player.registration_status = 'approved'
        and player.departed_at is null
    ),
    'my_registration', (
      select to_jsonb(player) - 'reviewed_by'
      from public.open_play_players player
      where player.session_id = session.id
        and player.user_id = auth.uid()
    )
  )
  from public.open_play_sessions session
  join public.profiles organizer on organizer.id = session.organizer_id
  join public.venues venue on venue.id = session.venue_id
  where auth.uid() is not null
    and session.status = 'active'
    and (
      session.visibility = 'public'
      or exists (
        select 1
        from public.open_play_invitations invitation
        where invitation.session_id = session.id
          and invitation.invited_user_id = auth.uid()
          and invitation.status in ('pending', 'accepted')
      )
      or exists (
        select 1
        from public.open_play_players player
        where player.session_id = session.id
          and player.user_id = auth.uid()
          and player.registration_status not in ('cancelled', 'rejected')
      )
    )
    and session.scheduled_end > now()
    and venue.active
    and venue.verification_status = 'verified'
  order by session.scheduled_start asc
$$;

create or replace function public.get_open_play_session(
  p_session_id text default null,
  p_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  registration public.open_play_players;
  invited boolean;
  allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into session_row
  from public.open_play_sessions
  where (p_session_id is not null and id = p_session_id)
     or (p_code is not null and upper(session_code) = upper(trim(p_code)))
  order by case when id = p_session_id then 0 else 1 end
  limit 1;

  if session_row.id is null or session_row.status <> 'active' then
    raise exception 'Open-play session not found';
  end if;

  select * into registration
  from public.open_play_players
  where session_id = session_row.id and user_id = auth.uid();

  select exists (
    select 1
    from public.open_play_invitations
    where session_id = session_row.id
      and invited_user_id = auth.uid()
      and status in ('pending', 'accepted')
  ) into invited;

  allowed := session_row.organizer_id = auth.uid()
    or session_row.visibility = 'public'
    or registration.id is not null
    or invited
    or (p_code is not null and upper(session_row.session_code) = upper(trim(p_code)));

  if not allowed then
    raise exception 'A valid invitation or session code is required';
  end if;

  return (
    select jsonb_build_object(
      'id', session_row.id,
      'name', session_row.name,
      'session_code', case
        when session_row.organizer_id = auth.uid() or p_code is not null
          then session_row.session_code
        else null
      end,
      'visibility', session_row.visibility,
      'approval_mode', session_row.approval_mode,
      'capacity', session_row.capacity,
      'skill_min', session_row.skill_min,
      'skill_max', session_row.skill_max,
      'fee_amount', session_row.fee_amount,
      'currency', session_row.currency,
      'scheduled_start', session_row.scheduled_start,
      'scheduled_end', session_row.scheduled_end,
      'rules', session_row.rules,
      'cancellation_policy', session_row.cancellation_policy,
      'match_format', session_row.match_format,
      'average_match_minutes', session_row.average_match_minutes,
      'max_consecutive_games', session_row.max_consecutive_games,
      'rest_minutes', session_row.rest_minutes,
      'organizer', jsonb_build_object(
        'id', organizer.id,
        'name', organizer.display_name,
        'avatar_url', organizer.avatar_url
      ),
      'venue', jsonb_build_object(
        'id', venue.id,
        'name', venue.name,
        'area', venue.area,
        'address', venue.address,
        'latitude', venue.latitude,
        'longitude', venue.longitude,
        'verified', venue.verification_status = 'verified'
      ),
      'registered_count', (
        select count(*)
        from public.open_play_players player
        where player.session_id = session_row.id
          and player.registration_status = 'approved'
          and player.departed_at is null
      ),
      'my_registration', case
        when registration.id is null then null
        else to_jsonb(registration) - 'reviewed_by'
      end
    )
    from public.profiles organizer
    join public.venues venue on venue.id = session_row.venue_id
    where organizer.id = session_row.organizer_id
  );
end
$$;
