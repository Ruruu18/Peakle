-- Prevent delayed organizer snapshots from reverting rally scores that were
-- already committed by the server-authoritative scoring functions.

create or replace function app_private.protect_open_play_authoritative_score()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role')
     and exists (
       select 1
       from public.open_play_score_events event
       where event.match_id = old.id
         and event.action is not null
     ) then
    new.home_score := old.home_score;
    new.away_score := old.away_score;
    new.server_side := old.server_side;
    new.serving_position := old.serving_position;
    new.service_number := old.service_number;
    new.status := old.status;
    new.winner_side := old.winner_side;
    new.ended_at := old.ended_at;
    new.recorded_match_id := old.recorded_match_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_open_play_authoritative_score_before_update on public.open_play_matches;
create trigger protect_open_play_authoritative_score_before_update
before update on public.open_play_matches
for each row execute function app_private.protect_open_play_authoritative_score();

-- Repair any live row already reverted by an older client. The last active
-- event is the canonical score and serve state.
with latest_event as (
  select distinct on (event.match_id)
    event.match_id,
    event.home_score,
    event.away_score,
    event.server_side,
    event.serving_position,
    event.service_number
  from public.open_play_score_events event
  where event.action is not null
    and event.undone_at is null
  order by event.match_id, event.id desc
)
update public.open_play_matches match
set home_score = latest.home_score,
    away_score = latest.away_score,
    server_side = latest.server_side,
    serving_position = latest.serving_position,
    service_number = latest.service_number
from latest_event latest
where match.id = latest.match_id
  and match.status = 'live'
  and (
    match.home_score is distinct from latest.home_score
    or match.away_score is distinct from latest.away_score
    or match.server_side is distinct from latest.server_side
    or match.serving_position is distinct from latest.serving_position
    or match.service_number is distinct from latest.service_number
  );

-- The organizer can operate the scorer as a fallback even when another
-- checked-in player is assigned as the courtside scorer.
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
  left join public.open_play_players scorer on scorer.id = match.scorer_player_id
  where match.id = p_match_id
    and match.status = 'live'
    and (scorer.user_id = auth.uid() or public.owns_open_play(match.session_id))
  for update of match;

  if live_match.id is null then raise exception 'Only the assigned player scorer or organizer can record this rally'; end if;
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
  left join public.open_play_players scorer on scorer.id = match.scorer_player_id
  where match.id = p_match_id
    and match.status = 'live'
    and (scorer.user_id = auth.uid() or public.owns_open_play(match.session_id))
  for update of match;

  if live_match.id is null then raise exception 'Only the assigned player scorer or organizer can undo this rally'; end if;

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
