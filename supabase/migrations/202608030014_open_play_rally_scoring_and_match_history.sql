-- Make player-scored Open Play use pickleball serve/side-out rules and record
-- the completed result in the same match history used by regular Play.

alter table public.open_play_matches
  add column if not exists server_side smallint not null default 0,
  add column if not exists serving_position smallint not null default 0,
  add column if not exists service_number smallint not null default 2,
  add column if not exists recorded_match_id uuid references public.matches(id) on delete set null;

create unique index if not exists open_play_matches_recorded_match_unique
  on public.open_play_matches(recorded_match_id)
  where recorded_match_id is not null;

alter table public.open_play_score_events
  add column if not exists rally_winner_side smallint,
  add column if not exists scoring_side smallint,
  add column if not exists action text,
  add column if not exists previous_home_score integer,
  add column if not exists previous_away_score integer,
  add column if not exists previous_server_side smallint,
  add column if not exists previous_serving_position smallint,
  add column if not exists previous_service_number smallint,
  add column if not exists server_side smallint,
  add column if not exists serving_position smallint,
  add column if not exists service_number smallint,
  add column if not exists recorded_by uuid references public.profiles(id) on delete set null,
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid references public.profiles(id) on delete set null;

create or replace function public.initialize_open_play_match_serve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  court_format text;
begin
  select court.match_format into court_format
  from public.open_play_courts court
  where court.id = new.session_court_id;
  new.server_side := 0;
  new.serving_position := 0;
  new.service_number := case when court_format = 'singles' then 1 else 2 end;
  return new;
end;
$$;

drop trigger if exists initialize_open_play_match_serve_before_insert on public.open_play_matches;
create trigger initialize_open_play_match_serve_before_insert
before insert on public.open_play_matches
for each row execute function public.initialize_open_play_match_serve();

update public.open_play_matches match
set service_number = case when court.match_format = 'singles' then 1 else greatest(match.service_number, 2) end
from public.open_play_courts court
where court.id = match.session_court_id
  and match.status = 'live';

create or replace function app_private.get_my_open_play_match(p_session_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  own_player public.open_play_players;
  live_match public.open_play_matches;
  session_court public.open_play_courts;
  latest_event public.open_play_score_events;
  has_undoable_event boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into own_player
  from public.open_play_players
  where session_id = p_session_id
    and user_id = auth.uid()
    and registration_status = 'approved';

  if own_player.id is null then return null; end if;

  select match.* into live_match
  from public.open_play_matches match
  join public.open_play_match_players lineup on lineup.match_id = match.id
  where match.session_id = p_session_id
    and match.status = 'live'
    and lineup.player_id = own_player.id
  order by match.started_at desc
  limit 1;

  if live_match.id is null then return null; end if;

  select * into session_court
  from public.open_play_courts
  where id = live_match.session_court_id;

  select event.* into latest_event
  from public.open_play_score_events event
  where event.match_id = live_match.id
    and event.action is not null
    and event.undone_at is null
  order by event.id desc
  limit 1;

  select exists(
    select 1 from public.open_play_score_events event
    where event.match_id = live_match.id
      and event.action is not null
      and event.action <> 'undo'
      and event.undone_at is null
  ) into has_undoable_event;

  return jsonb_build_object(
    'id', live_match.id,
    'status', live_match.status,
    'court_id', session_court.id,
    'court_number', session_court.court_number,
    'court_name', coalesce((select court.name from public.courts court where court.id = session_court.venue_court_id), 'Court ' || session_court.court_number),
    'match_format', session_court.match_format,
    'home_score', live_match.home_score,
    'away_score', live_match.away_score,
    'server_side', live_match.server_side,
    'serving_position', live_match.serving_position,
    'service_number', live_match.service_number,
    'can_undo', has_undoable_event,
    'last_event', case when latest_event.id is null then null else jsonb_build_object(
      'id', latest_event.id,
      'winning_side', latest_event.rally_winner_side,
      'action', latest_event.action,
      'home_score', latest_event.home_score,
      'away_score', latest_event.away_score,
      'server_side', latest_event.server_side,
      'serving_position', latest_event.serving_position,
      'service_number', latest_event.service_number
    ) end,
    'started_at', live_match.started_at,
    'scorer_player_id', live_match.scorer_player_id,
    'can_score', live_match.scorer_player_id = own_player.id,
    'scorer_name', (
      select coalesce(profile.display_name, scorer.guest_name, 'Assigned scorer')
      from public.open_play_players scorer
      left join public.profiles profile on profile.id = scorer.user_id
      where scorer.id = live_match.scorer_player_id
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', player.id,
        'user_id', player.user_id,
        'name', coalesce(profile.display_name, player.guest_name, 'Guest player'),
        'avatar_url', profile.avatar_url,
        'side', lineup.side,
        'position', lineup.position,
        'is_me', player.id = own_player.id,
        'is_scorer', player.id = live_match.scorer_player_id
      ) order by lineup.side, lineup.position)
      from public.open_play_match_players lineup
      join public.open_play_players player on player.id = lineup.player_id
      left join public.profiles profile on profile.id = player.user_id
      where lineup.match_id = live_match.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.record_open_play_rally(
  p_match_id text,
  p_winning_side smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_match public.open_play_matches;
  court_format text;
  next_home integer;
  next_away integer;
  next_server smallint;
  next_position smallint;
  next_service smallint;
  rally_action text;
  scoring_side smallint;
  event_id bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_winning_side is null or p_winning_side not in (0, 1) then raise exception 'Choose the team that won the rally'; end if;

  select match.* into live_match
  from public.open_play_matches match
  join public.open_play_players scorer on scorer.id = match.scorer_player_id
  where match.id = p_match_id
    and match.status = 'live'
    and scorer.user_id = auth.uid()
  for update of match;

  if live_match.id is null then raise exception 'Only the assigned player scorer can record this rally'; end if;
  if greatest(live_match.home_score, live_match.away_score) >= 11
     and abs(live_match.home_score - live_match.away_score) >= 2 then
    raise exception 'This match is ready to finish';
  end if;

  select court.match_format into court_format
  from public.open_play_courts court
  where court.id = live_match.session_court_id;

  next_home := live_match.home_score;
  next_away := live_match.away_score;
  next_server := live_match.server_side;
  next_position := live_match.serving_position;
  next_service := case when court_format = 'singles' then 1 else live_match.service_number end;

  if p_winning_side = live_match.server_side then
    if p_winning_side = 0 then next_home := next_home + 1; else next_away := next_away + 1; end if;
    rally_action := 'point';
    scoring_side := p_winning_side;
  elsif court_format = 'doubles' and live_match.service_number = 1 then
    next_position := case when live_match.serving_position = 0 then 1 else 0 end;
    next_service := 2;
    rally_action := 'second_server';
    scoring_side := null;
  else
    next_server := 1 - live_match.server_side;
    next_position := 0;
    next_service := 1;
    rally_action := 'side_out';
    scoring_side := null;
  end if;

  update public.open_play_matches
  set home_score = next_home,
      away_score = next_away,
      server_side = next_server,
      serving_position = next_position,
      service_number = next_service
  where id = p_match_id;

  insert into public.open_play_score_events(
    match_id, home_score, away_score, rally_winner_side, scoring_side, action,
    previous_home_score, previous_away_score, previous_server_side,
    previous_serving_position, previous_service_number, server_side,
    serving_position, service_number, recorded_by
  ) values (
    p_match_id, next_home, next_away, p_winning_side, scoring_side, rally_action,
    live_match.home_score, live_match.away_score, live_match.server_side,
    live_match.serving_position, live_match.service_number, next_server,
    next_position, next_service, auth.uid()
  ) returning id into event_id;

  return jsonb_build_object(
    'id', event_id,
    'winning_side', p_winning_side,
    'action', rally_action,
    'home_score', next_home,
    'away_score', next_away,
    'server_side', next_server,
    'serving_position', next_position,
    'service_number', next_service,
    'can_undo', true
  );
end;
$$;

create or replace function app_private.undo_open_play_rally(p_match_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_match public.open_play_matches;
  latest_event public.open_play_score_events;
  another_event boolean;
  undo_event_id bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select match.* into live_match
  from public.open_play_matches match
  join public.open_play_players scorer on scorer.id = match.scorer_player_id
  where match.id = p_match_id
    and match.status = 'live'
    and scorer.user_id = auth.uid()
  for update of match;

  if live_match.id is null then raise exception 'Only the assigned player scorer can undo this rally'; end if;

  select event.* into latest_event
  from public.open_play_score_events event
  where event.match_id = p_match_id
    and event.action is not null
    and event.action <> 'undo'
    and event.undone_at is null
  order by event.id desc
  limit 1
  for update;

  if latest_event.id is null then raise exception 'There is no rally to undo'; end if;

  update public.open_play_matches
  set home_score = latest_event.previous_home_score,
      away_score = latest_event.previous_away_score,
      server_side = latest_event.previous_server_side,
      serving_position = latest_event.previous_serving_position,
      service_number = latest_event.previous_service_number
  where id = p_match_id;

  update public.open_play_score_events
  set undone_at = now(), undone_by = auth.uid()
  where id = latest_event.id;

  insert into public.open_play_score_events(
    match_id, home_score, away_score, rally_winner_side, action,
    previous_home_score, previous_away_score, previous_server_side,
    previous_serving_position, previous_service_number, server_side,
    serving_position, service_number, recorded_by
  ) values (
    p_match_id, latest_event.previous_home_score, latest_event.previous_away_score,
    latest_event.rally_winner_side, 'undo', live_match.home_score,
    live_match.away_score, live_match.server_side, live_match.serving_position,
    live_match.service_number, latest_event.previous_server_side,
    latest_event.previous_serving_position, latest_event.previous_service_number,
    auth.uid()
  ) returning id into undo_event_id;

  select exists(
    select 1 from public.open_play_score_events event
    where event.match_id = p_match_id
      and event.action is not null
      and event.action <> 'undo'
      and event.undone_at is null
  ) into another_event;

  return jsonb_build_object(
    'id', undo_event_id,
    'winning_side', latest_event.rally_winner_side,
    'action', 'undo',
    'home_score', latest_event.previous_home_score,
    'away_score', latest_event.previous_away_score,
    'server_side', latest_event.previous_server_side,
    'serving_position', latest_event.previous_serving_position,
    'service_number', latest_event.previous_service_number,
    'can_undo', another_event
  );
end;
$$;

create or replace function app_private.complete_open_play_match_by_scorer(
  p_match_id text,
  p_home_score integer,
  p_away_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_match public.open_play_matches;
  session_row public.open_play_sessions;
  court_row public.open_play_courts;
  next_position integer;
  winner smallint;
  completed_at timestamptz := now();
  history_match_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_home_score < 0 or p_away_score < 0 then raise exception 'Scores cannot be negative'; end if;
  if p_home_score = p_away_score then raise exception 'Finish the match with a winning side'; end if;
  if greatest(p_home_score, p_away_score) < 11 or abs(p_home_score - p_away_score) < 2 then
    raise exception 'Open Play matches finish at 11 points with a two-point lead';
  end if;

  select match.* into live_match
  from public.open_play_matches match
  join public.open_play_players scorer on scorer.id = match.scorer_player_id
  where match.id = p_match_id
    and match.status = 'live'
    and scorer.user_id = auth.uid()
  for update of match;

  if live_match.id is null then raise exception 'Only the assigned player scorer can finish this match'; end if;
  if live_match.home_score <> p_home_score or live_match.away_score <> p_away_score then
    raise exception 'The live score changed. Refresh before finishing the match';
  end if;

  select * into session_row from public.open_play_sessions where id = live_match.session_id for update;
  select * into court_row from public.open_play_courts where id = live_match.session_court_id;
  winner := case when p_home_score > p_away_score then 0 else 1 end;
  history_match_id := live_match.recorded_match_id;

  if history_match_id is null then
    insert into public.matches(
      created_by, venue_id, court_id, match_type, mode, visibility,
      target_score, best_of, win_by_two, status, started_at, ended_at, scorer_id
    ) values (
      session_row.organizer_id, session_row.venue_id, court_row.venue_court_id,
      court_row.match_format, 'casual', case when session_row.visibility = 'public' then 'public' else 'private' end,
      11, 1, true, 'completed', live_match.started_at, completed_at, auth.uid()
    ) returning id into history_match_id;

    insert into public.match_participants(match_id, user_id, guest_name, side, position)
    select history_match_id, player.user_id,
      case when player.user_id is null then coalesce(player.guest_name, 'Guest player') else null end,
      lineup.side, lineup.position
    from public.open_play_match_players lineup
    join public.open_play_players player on player.id = lineup.player_id
    where lineup.match_id = p_match_id;

    insert into public.match_games(match_id, game_number, home_score, away_score, winner_side, started_at, ended_at)
    values(history_match_id, 1, p_home_score, p_away_score, winner, live_match.started_at, completed_at);
  end if;

  update public.open_play_matches
  set home_score = p_home_score,
      away_score = p_away_score,
      winner_side = winner,
      status = 'completed',
      ended_at = completed_at,
      recorded_match_id = history_match_id
  where id = p_match_id;

  update public.open_play_players player
  set games_played = games_played + 1,
      consecutive_games = consecutive_games + 1,
      last_match_ended_at = completed_at,
      waiting_since = completed_at,
      status = 'waiting',
      departed_at = null,
      queue_position = null
  where player.id in (
    select lineup.player_id from public.open_play_match_players lineup where lineup.match_id = p_match_id
  );

  select coalesce(max(queue_position), -1) + 1 into next_position
  from public.open_play_players
  where session_id = session_row.id;

  with returned as (
    select lineup.player_id, row_number() over(order by lineup.side, lineup.position) - 1 as offset_position
    from public.open_play_match_players lineup
    where lineup.match_id = p_match_id
  )
  update public.open_play_players player
  set queue_position = next_position + returned.offset_position
  from returned
  where player.id = returned.player_id;

  return jsonb_build_object(
    'match_id', p_match_id,
    'recorded_match_id', history_match_id,
    'home_score', p_home_score,
    'away_score', p_away_score,
    'winner_side', winner,
    'completed_at', completed_at
  );
end;
$$;

-- Backfill completed Open Play results that predate the shared history link.
do $$
declare
  source record;
  history_match_id uuid;
begin
  for source in
    select match.*, session.organizer_id, session.venue_id, session.visibility,
      court.venue_court_id, court.match_format
    from public.open_play_matches match
    join public.open_play_sessions session on session.id = match.session_id
    join public.open_play_courts court on court.id = match.session_court_id
    where match.status = 'completed'
      and match.recorded_match_id is null
      and match.ended_at is not null
  loop
    insert into public.matches(
      created_by, venue_id, court_id, match_type, mode, visibility,
      target_score, best_of, win_by_two, status, started_at, ended_at, scorer_id
    ) values (
      source.organizer_id, source.venue_id, source.venue_court_id,
      source.match_format, 'casual', case when source.visibility = 'public' then 'public' else 'private' end,
      11, 1, true, 'completed', source.started_at, source.ended_at,
      (select player.user_id from public.open_play_players player where player.id = source.scorer_player_id)
    ) returning id into history_match_id;

    insert into public.match_participants(match_id, user_id, guest_name, side, position)
    select history_match_id, player.user_id,
      case when player.user_id is null then coalesce(player.guest_name, 'Guest player') else null end,
      lineup.side, lineup.position
    from public.open_play_match_players lineup
    join public.open_play_players player on player.id = lineup.player_id
    where lineup.match_id = source.id;

    insert into public.match_games(match_id, game_number, home_score, away_score, winner_side, started_at, ended_at)
    values(history_match_id, 1, source.home_score, source.away_score, source.winner_side, source.started_at, source.ended_at);

    update public.open_play_matches set recorded_match_id = history_match_id where id = source.id;
  end loop;
end;
$$;

create or replace function public.get_my_open_play_match(p_session_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select app_private.get_my_open_play_match(p_session_id) $$;

create or replace function public.record_open_play_rally(p_match_id text, p_winning_side smallint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.record_open_play_rally(p_match_id, p_winning_side) $$;

create or replace function public.undo_open_play_rally(p_match_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.undo_open_play_rally(p_match_id) $$;

create or replace function public.complete_open_play_match_by_scorer(
  p_match_id text,
  p_home_score integer,
  p_away_score integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.complete_open_play_match_by_scorer(p_match_id, p_home_score, p_away_score) $$;

revoke all on function public.initialize_open_play_match_serve() from public, anon, authenticated;
revoke all on function app_private.get_my_open_play_match(text) from public, anon;
revoke all on function app_private.record_open_play_rally(text, smallint) from public, anon;
revoke all on function app_private.undo_open_play_rally(text) from public, anon;
revoke all on function app_private.complete_open_play_match_by_scorer(text, integer, integer) from public, anon;
revoke all on function public.get_my_open_play_match(text) from public, anon;
revoke all on function public.record_open_play_rally(text, smallint) from public, anon;
revoke all on function public.undo_open_play_rally(text) from public, anon;
revoke all on function public.complete_open_play_match_by_scorer(text, integer, integer) from public, anon;
grant execute on function app_private.get_my_open_play_match(text) to authenticated, service_role;
grant execute on function app_private.record_open_play_rally(text, smallint) to authenticated, service_role;
grant execute on function app_private.undo_open_play_rally(text) to authenticated, service_role;
grant execute on function app_private.complete_open_play_match_by_scorer(text, integer, integer) to authenticated, service_role;
grant execute on function public.get_my_open_play_match(text) to authenticated, service_role;
grant execute on function public.record_open_play_rally(text, smallint) to authenticated, service_role;
grant execute on function public.undo_open_play_rally(text) to authenticated, service_role;
grant execute on function public.complete_open_play_match_by_scorer(text, integer, integer) to authenticated, service_role;
