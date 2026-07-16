-- Priority 2: explainable, conflict-safe open-play rotations.

alter table public.open_play_sessions
  add column if not exists match_format text not null default 'doubles',
  add column if not exists average_match_minutes integer not null default 15,
  add column if not exists max_consecutive_games integer not null default 2,
  add column if not exists rest_minutes integer not null default 0;

alter table public.open_play_sessions
  drop constraint if exists open_play_sessions_match_format_check,
  drop constraint if exists open_play_sessions_average_match_minutes_check,
  drop constraint if exists open_play_sessions_max_consecutive_games_check,
  drop constraint if exists open_play_sessions_rest_minutes_check;
alter table public.open_play_sessions
  add constraint open_play_sessions_match_format_check check (match_format in ('singles', 'doubles')),
  add constraint open_play_sessions_average_match_minutes_check check (average_match_minutes between 5 and 90),
  add constraint open_play_sessions_max_consecutive_games_check check (max_consecutive_games between 0 and 10),
  add constraint open_play_sessions_rest_minutes_check check (rest_minutes between 0 and 120);

alter table public.open_play_players
  add column if not exists waiting_since timestamptz,
  add column if not exists consecutive_games integer not null default 0,
  add column if not exists last_match_ended_at timestamptz,
  add column if not exists play_preference text not null default 'either',
  add column if not exists priority_boost integer not null default 0;

update public.open_play_players
set waiting_since = coalesce(waiting_since, checked_in_at, joined_at)
where status = 'waiting' and checked_in_at is not null;

alter table public.open_play_players
  drop constraint if exists open_play_players_consecutive_games_check,
  drop constraint if exists open_play_players_play_preference_check,
  drop constraint if exists open_play_players_priority_boost_check;
alter table public.open_play_players
  add constraint open_play_players_consecutive_games_check check (consecutive_games between 0 and 1000),
  add constraint open_play_players_play_preference_check check (play_preference in ('either', 'singles', 'doubles')),
  add constraint open_play_players_priority_boost_check check (priority_boost between -10 and 10);

create or replace function public.set_open_play_waiting_since()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'waiting' and new.checked_in_at is not null
    and (old.status is distinct from 'waiting' or old.checked_in_at is null or old.departed_at is not null)
  then new.waiting_since := now();
  end if;
  return new;
end;
$$;
drop trigger if exists set_open_play_waiting_since_before_update on public.open_play_players;
create trigger set_open_play_waiting_since_before_update
before update of status, checked_in_at, departed_at on public.open_play_players
for each row execute function public.set_open_play_waiting_since();

create table public.open_play_rotation_decisions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  session_court_id text not null references public.open_play_courts(id) on delete cascade,
  match_id text not null unique references public.open_play_matches(id) on delete cascade,
  selected_player_ids text[] not null,
  recommended_player_ids text[] not null,
  explanation jsonb not null default '{}'::jsonb,
  overridden boolean not null default false,
  override_reason text,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (cardinality(selected_player_ids) in (2, 4)),
  check (cardinality(recommended_player_ids) in (2, 4)),
  check (not overridden or char_length(trim(coalesce(override_reason, ''))) >= 8)
);
create index open_play_rotation_decisions_session_idx
  on public.open_play_rotation_decisions(session_id, created_at desc);
create unique index open_play_one_live_match_per_court_idx
  on public.open_play_matches(session_court_id) where status = 'live';

create or replace function public.prevent_duplicate_live_open_play_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists(
    select 1
    from public.open_play_match_players lineup
    join public.open_play_matches active_match on active_match.id = lineup.match_id
    where lineup.player_id = new.player_id and active_match.status = 'live' and lineup.match_id <> new.match_id
  ) then raise exception 'This player is already assigned to a live court'; end if;
  return new;
end;
$$;
drop trigger if exists prevent_duplicate_live_open_play_player_before_insert on public.open_play_match_players;
create trigger prevent_duplicate_live_open_play_player_before_insert
before insert or update of player_id, match_id on public.open_play_match_players
for each row execute function public.prevent_duplicate_live_open_play_player();

alter table public.open_play_rotation_decisions enable row level security;
revoke all on table public.open_play_rotation_decisions from anon;
grant select on table public.open_play_rotation_decisions to authenticated;

create policy "organizers read rotation audit"
on public.open_play_rotation_decisions for select to authenticated
using (public.owns_open_play(session_id));

create policy "players read their session rotation audit"
on public.open_play_rotation_decisions for select to authenticated
using (exists (
  select 1 from public.open_play_players player
  where player.session_id = open_play_rotation_decisions.session_id
    and player.user_id = auth.uid()
    and player.registration_status = 'approved'
));

create policy "approved players read live open play courts"
on public.open_play_courts for select to authenticated
using (exists (
  select 1 from public.open_play_players player
  where player.session_id = open_play_courts.session_id
    and player.user_id = auth.uid()
    and player.registration_status = 'approved'
));

create policy "approved players read live open play matches"
on public.open_play_matches for select to authenticated
using (exists (
  select 1 from public.open_play_players player
  where player.session_id = open_play_matches.session_id
    and player.user_id = auth.uid()
    and player.registration_status = 'approved'
));

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_play_courts') then
    alter publication supabase_realtime add table public.open_play_courts;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_play_matches') then
    alter publication supabase_realtime add table public.open_play_matches;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_play_rotation_decisions') then
    alter publication supabase_realtime add table public.open_play_rotation_decisions;
  end if;
end $$;

create or replace function public.create_open_play_session(
  p_name text,
  p_venue_id text,
  p_court_count integer,
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_active_organizer_entitlement(auth.uid()) then raise exception 'An active Organizer Pass is required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Session name is required'; end if;
  if p_court_count not between 1 and 8 then raise exception 'Choose between 1 and 8 courts'; end if;
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
  if not exists(select 1 from public.venues where id = p_venue_id and active and verification_status = 'verified') then raise exception 'Choose a verified active venue'; end if;

  loop
    generated_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists(select 1 from public.open_play_sessions where session_code = generated_code);
  end loop;

  insert into public.open_play_sessions(
    id, organizer_id, venue_id, name, status, court_count, session_code,
    visibility, approval_mode, capacity, skill_min, skill_max, fee_amount,
    scheduled_start, scheduled_end, rules, cancellation_policy,
    match_format, average_match_minutes, max_consecutive_games, rest_minutes
  ) values (
    gen_random_uuid()::text, auth.uid(), p_venue_id, trim(p_name), 'active', p_court_count, generated_code,
    p_visibility, p_approval_mode, p_capacity, p_skill_min, p_skill_max, p_fee_amount,
    p_scheduled_start, p_scheduled_end,
    coalesce(nullif(trim(p_rules), ''), 'Doubles · First to 11 · Win by 2'),
    coalesce(nullif(trim(p_cancellation_policy), ''), 'Cancel before the session starts so a waitlisted player can take your place.'),
    p_match_format, p_average_match_minutes, p_max_consecutive_games, p_rest_minutes
  ) returning * into created;
  return created;
end;
$$;

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
  expected_count integer;
  selected_count integer;
  is_override boolean;
begin
  select * into session_row from public.open_play_sessions where id = p_session_id for update;
  if session_row.id is null or session_row.status <> 'active' then raise exception 'Active session not found'; end if;
  if not public.owns_open_play(session_row.id) then raise exception 'Session staff permission required'; end if;
  expected_count := case when session_row.match_format = 'singles' then 2 else 4 end;
  if cardinality(p_player_ids) <> expected_count or cardinality(p_recommended_ids) <> expected_count then raise exception 'The lineup has the wrong number of players'; end if;
  select count(distinct selected.id) into selected_count from unnest(p_player_ids) selected(id);
  if selected_count <> expected_count then raise exception 'Each assigned player must be unique'; end if;
  if not (p_scorer_player_id = any(p_player_ids)) then raise exception 'The scorer must be in the lineup'; end if;
  if not exists(select 1 from public.open_play_courts where id = p_court_id and session_id = p_session_id) then raise exception 'Court does not belong to this session'; end if;
  if exists(select 1 from public.open_play_matches where session_court_id = p_court_id and status = 'live') then raise exception 'This court already has a live match'; end if;
  perform 1 from public.open_play_players
  where session_id = p_session_id and id = any(p_player_ids)
  for update;
  select count(*) into selected_count
  from public.open_play_players
  where session_id = p_session_id and id = any(p_player_ids)
    and registration_status = 'approved' and checked_in_at is not null
    and departed_at is null and status = 'waiting' and queue_position is not null;
  if selected_count <> expected_count then raise exception 'One or more players are no longer available'; end if;

  is_override := p_player_ids <> p_recommended_ids;
  if is_override and char_length(trim(coalesce(p_override_reason, ''))) < 8 then raise exception 'Explain the lineup override in at least 8 characters'; end if;

  insert into public.open_play_matches(id, session_id, session_court_id, scorer_player_id, status)
  values(p_match_id, p_session_id, p_court_id, p_scorer_player_id, 'live');
  insert into public.open_play_match_players(match_id, player_id, side, position)
  select p_match_id, player_id,
    case when expected_count = 2 then ordinal - 1 when ordinal <= 2 then 0 else 1 end,
    case when expected_count = 2 then 0 when ordinal in (1, 3) then 0 else 1 end
  from unnest(p_player_ids) with ordinality selected(player_id, ordinal);

  update public.open_play_players
  set status = 'playing', queue_position = null
  where session_id = p_session_id and id = any(p_player_ids);
  update public.open_play_players
  set consecutive_games = 0
  where session_id = p_session_id and status = 'waiting' and queue_position is not null and not (id = any(p_player_ids));

  with ordered as (
    select id, row_number() over(order by queue_position, waiting_since, joined_at) - 1 as next_position
    from public.open_play_players
    where session_id = p_session_id and status = 'waiting' and queue_position is not null
  )
  update public.open_play_players player set queue_position = ordered.next_position
  from ordered where player.id = ordered.id;

  insert into public.open_play_rotation_decisions(
    session_id, session_court_id, match_id, selected_player_ids, recommended_player_ids,
    explanation, overridden, override_reason, decided_by
  ) values (
    p_session_id, p_court_id, p_match_id, p_player_ids, p_recommended_ids,
    coalesce(p_explanation, '{}'::jsonb), is_override, nullif(trim(p_override_reason), ''), auth.uid()
  );

  return jsonb_build_object('match_id', p_match_id, 'overridden', is_override, 'assigned_at', now());
end;
$$;

create or replace function public.complete_fair_play_match(
  p_match_id text,
  p_done_player_ids text[],
  p_home_score integer,
  p_away_score integer,
  p_winner_side smallint,
  p_ended_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.open_play_matches;
  session_row public.open_play_sessions;
  next_position integer;
begin
  select * into match_row from public.open_play_matches where id = p_match_id for update;
  if match_row.id is null or match_row.status <> 'live' then raise exception 'Live match not found'; end if;
  select * into session_row from public.open_play_sessions where id = match_row.session_id for update;
  if not public.owns_open_play(session_row.id) then raise exception 'Session staff permission required'; end if;
  if p_home_score < 0 or p_away_score < 0 or (p_winner_side is not null and p_winner_side not in (0, 1)) then raise exception 'Invalid final score'; end if;
  if exists(select 1 from unnest(coalesce(p_done_player_ids, array[]::text[])) departed(id) where not exists(select 1 from public.open_play_match_players where match_id = p_match_id and player_id = departed.id)) then raise exception 'Only players in this match can depart'; end if;

  update public.open_play_matches
  set home_score = p_home_score, away_score = p_away_score, winner_side = p_winner_side,
      status = 'completed', ended_at = coalesce(p_ended_at, now())
  where id = p_match_id;

  update public.open_play_players player
  set games_played = games_played + 1,
      consecutive_games = consecutive_games + 1,
      last_match_ended_at = coalesce(p_ended_at, now()),
      waiting_since = case when player.id = any(coalesce(p_done_player_ids, array[]::text[])) then waiting_since else coalesce(p_ended_at, now()) end,
      status = case when player.id = any(coalesce(p_done_player_ids, array[]::text[])) then 'done' else 'waiting' end,
      departed_at = case when player.id = any(coalesce(p_done_player_ids, array[]::text[])) then coalesce(p_ended_at, now()) else null end,
      queue_position = null
  where player.id in (select match_player.player_id from public.open_play_match_players match_player where match_player.match_id = p_match_id);

  select coalesce(max(queue_position), -1) + 1 into next_position
  from public.open_play_players where session_id = session_row.id;
  with returned as (
    select match_player.player_id, row_number() over(order by match_player.side, match_player.position) - 1 as offset_position
    from public.open_play_match_players match_player
    join public.open_play_players player on player.id = match_player.player_id
    where match_player.match_id = p_match_id and player.status = 'waiting'
  )
  update public.open_play_players player set queue_position = next_position + returned.offset_position
  from returned where player.id = returned.player_id;

  return jsonb_build_object('match_id', p_match_id, 'completed_at', coalesce(p_ended_at, now()));
end;
$$;

create or replace function public.get_open_play_live_state(p_session_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  own_player public.open_play_players;
  wait_groups integer;
  open_courts integer;
  estimated integer;
begin
  select * into session_row from public.open_play_sessions where id = p_session_id;
  if session_row.id is null then return null; end if;
  select * into own_player from public.open_play_players where session_id = p_session_id and user_id = auth.uid();
  if session_row.organizer_id <> auth.uid() and (own_player.id is null or own_player.registration_status <> 'approved') then return null; end if;

  select count(*) into open_courts from public.open_play_courts court
  where court.session_id = p_session_id
    and not exists(select 1 from public.open_play_matches active_match where active_match.session_court_id = court.id and active_match.status = 'live');
  if own_player.queue_position is not null then
    wait_groups := floor(own_player.queue_position / (case when session_row.match_format = 'singles' then 2 else 4 end));
    estimated := case when wait_groups < open_courts then 0 else greatest(1, ceil((wait_groups - open_courts + 1)::numeric / greatest(session_row.court_count, 1))::integer * session_row.average_match_minutes) end;
  end if;

  return jsonb_build_object(
    'queue_position', case when own_player.queue_position is null then null else own_player.queue_position + 1 end,
    'estimated_wait_minutes', estimated,
    'nearly_on_court', own_player.queue_position is not null and own_player.queue_position < (case when session_row.match_format = 'singles' then 4 else 8 end),
    'waiting_count', (select count(*) from public.open_play_players where session_id = p_session_id and status = 'waiting' and queue_position is not null),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', court.id,
        'number', court.court_number,
        'status', case when active_match.id is null then 'open' else 'playing' end,
        'score', case when active_match.id is null then null else jsonb_build_array(active_match.home_score, active_match.away_score) end,
        'players', case when active_match.id is null then '[]'::jsonb else coalesce((select jsonb_agg(coalesce(profile.display_name, player.guest_name) order by lineup.side, lineup.position)
          from public.open_play_match_players lineup
          join public.open_play_players player on player.id = lineup.player_id
          left join public.profiles profile on profile.id = player.user_id
          where lineup.match_id = active_match.id), '[]'::jsonb) end
      ) order by court.court_number)
      from public.open_play_courts court
      left join public.open_play_matches active_match on active_match.session_court_id = court.id and active_match.status = 'live'
      where court.session_id = p_session_id
    ), '[]'::jsonb),
    'latest_decision', (
      select jsonb_build_object(
        'explanation', decision.explanation,
        'overridden', decision.overridden,
        'override_reason', decision.override_reason,
        'created_at', decision.created_at
      ) from public.open_play_rotation_decisions decision
      where decision.session_id = p_session_id order by decision.created_at desc limit 1
    )
  );
end;
$$;

revoke all on function public.create_open_play_session(text, text, integer, integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer) from public;
revoke all on function public.assign_fair_play_match(text, text, text, text[], text, jsonb, text[], text) from public;
revoke all on function public.complete_fair_play_match(text, text[], integer, integer, smallint, timestamptz) from public;
revoke all on function public.get_open_play_live_state(text) from public;
grant execute on function public.create_open_play_session(text, text, integer, integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.assign_fair_play_match(text, text, text, text[], text, jsonb, text[], text) to authenticated;
grant execute on function public.complete_fair_play_match(text, text[], integer, integer, smallint, timestamptz) to authenticated;
grant execute on function public.get_open_play_live_state(text) to authenticated;
