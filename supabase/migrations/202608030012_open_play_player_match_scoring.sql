-- Put assigned Open Play players into a real live match. The organizer owns
-- court rotation; the designated signed-in player owns the score.

create or replace function public.get_my_open_play_match(p_session_id text)
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

  return jsonb_build_object(
    'id', live_match.id,
    'status', live_match.status,
    'court_id', session_court.id,
    'court_number', session_court.court_number,
    'court_name', coalesce((select court.name from public.courts court where court.id = session_court.venue_court_id), 'Court ' || session_court.court_number),
    'match_format', session_court.match_format,
    'home_score', live_match.home_score,
    'away_score', live_match.away_score,
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

create or replace function public.update_open_play_match_score(
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_home_score < 0 or p_away_score < 0 then raise exception 'Scores cannot be negative'; end if;

  select match.* into live_match
  from public.open_play_matches match
  join public.open_play_players scorer on scorer.id = match.scorer_player_id
  where match.id = p_match_id
    and match.status = 'live'
    and scorer.user_id = auth.uid()
  for update of match;

  if live_match.id is null then raise exception 'Only the assigned player scorer can update this match'; end if;

  update public.open_play_matches
  set home_score = p_home_score, away_score = p_away_score
  where id = p_match_id;

  insert into public.open_play_score_events(match_id, home_score, away_score)
  values(p_match_id, p_home_score, p_away_score);

  return jsonb_build_object(
    'match_id', p_match_id,
    'home_score', p_home_score,
    'away_score', p_away_score,
    'updated_at', now()
  );
end;
$$;

create or replace function public.complete_open_play_match_by_scorer(
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
  next_position integer;
  winner smallint;
  completed_at timestamptz := now();
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

  select * into session_row
  from public.open_play_sessions
  where id = live_match.session_id
  for update;

  winner := case when p_home_score > p_away_score then 0 else 1 end;

  update public.open_play_matches
  set home_score = p_home_score,
      away_score = p_away_score,
      winner_side = winner,
      status = 'completed',
      ended_at = completed_at
  where id = p_match_id;

  insert into public.open_play_score_events(match_id, home_score, away_score)
  values(p_match_id, p_home_score, p_away_score);

  update public.open_play_players player
  set games_played = games_played + 1,
      consecutive_games = consecutive_games + 1,
      last_match_ended_at = completed_at,
      waiting_since = completed_at,
      status = 'waiting',
      departed_at = null,
      queue_position = null
  where player.id in (
    select lineup.player_id
    from public.open_play_match_players lineup
    where lineup.match_id = p_match_id
  );

  select coalesce(max(queue_position), -1) + 1 into next_position
  from public.open_play_players
  where session_id = session_row.id;

  with returned as (
    select lineup.player_id,
      row_number() over(order by lineup.side, lineup.position) - 1 as offset_position
    from public.open_play_match_players lineup
    where lineup.match_id = p_match_id
  )
  update public.open_play_players player
  set queue_position = next_position + returned.offset_position
  from returned
  where player.id = returned.player_id;

  return jsonb_build_object(
    'match_id', p_match_id,
    'home_score', p_home_score,
    'away_score', p_away_score,
    'winner_side', winner,
    'completed_at', completed_at
  );
end;
$$;

revoke all on function public.get_my_open_play_match(text) from public;
revoke all on function public.update_open_play_match_score(text, integer, integer) from public;
revoke all on function public.complete_open_play_match_by_scorer(text, integer, integer) from public;
grant execute on function public.get_my_open_play_match(text) to authenticated;
grant execute on function public.update_open_play_match_score(text, integer, integer) to authenticated;
grant execute on function public.complete_open_play_match_by_scorer(text, integer, integer) to authenticated;
