-- Team challenge matches had no scoring backend at all: TeamScreen's live
-- score state lived only in client memory. This gives them the same
-- server-authoritative, append-only rally scoring that Open Play matches
-- already have (see 202608030012/14/15), scoped to team_challenges/teams
-- instead of open_play_sessions/courts.

create table if not exists public.team_matches (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.team_challenges(id) on delete cascade,
  home_team_id uuid not null references public.teams(id) on delete cascade,
  away_team_id uuid not null references public.teams(id) on delete cascade,
  match_format text not null default 'doubles' check (match_format in ('singles','doubles','mixed')),
  scorer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'live' check (status in ('live','completed')),
  home_score integer not null default 0 check (home_score >= 0),
  away_score integer not null default 0 check (away_score >= 0),
  server_side smallint not null default 0 check (server_side in (0,1)),
  serving_position smallint not null default 0 check (serving_position in (0,1)),
  service_number smallint not null default 2 check (service_number in (1,2)),
  game integer not null default 1 check (game > 0),
  completed_games jsonb not null default '[]'::jsonb,
  winner_side smallint check (winner_side in (0,1)),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);

create index if not exists team_matches_home_idx on public.team_matches(home_team_id, status);
create index if not exists team_matches_away_idx on public.team_matches(away_team_id, status);

drop trigger if exists team_matches_updated on public.team_matches;
create trigger team_matches_updated before update on public.team_matches
  for each row execute function public.set_updated_at();

create table if not exists public.team_match_score_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.team_matches(id) on delete cascade,
  game integer not null,
  action text not null check (action in ('point','second_server','side_out','undo','game_complete')),
  rally_winner_side smallint check (rally_winner_side in (0,1)),
  scoring_side smallint check (scoring_side in (0,1)),
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  previous_home_score integer,
  previous_away_score integer,
  previous_server_side smallint,
  previous_serving_position smallint,
  previous_service_number smallint,
  server_side smallint,
  serving_position smallint,
  service_number smallint,
  recorded_by uuid references public.profiles(id) on delete set null,
  undone_at timestamptz,
  undone_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists team_match_score_events_match_idx on public.team_match_score_events(match_id, id desc);

alter table public.team_matches enable row level security;
alter table public.team_match_score_events enable row level security;

create or replace function public.can_view_team_match(target_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.team_matches m
    where m.id = target_match
      and (public.is_team_member(m.home_team_id) or public.is_team_member(m.away_team_id))
  )
$$;

create or replace function public.can_score_team_match(target_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.team_matches m
    where m.id = target_match
      and (
        m.scorer_id = auth.uid()
        or public.can_manage_team(m.home_team_id)
        or public.can_manage_team(m.away_team_id)
      )
  )
$$;

drop policy if exists "team members view their matches" on public.team_matches;
create policy "team members view their matches" on public.team_matches
  for select to authenticated using (public.can_view_team_match(id));

drop policy if exists "team members view their match history" on public.team_match_score_events;
create policy "team members view their match history" on public.team_match_score_events
  for select to authenticated using (public.can_view_team_match(match_id));

-- All writes go through the security-definer functions below; there are no
-- insert/update policies, so clients cannot bypass the append-only log.

create or replace function public.get_team_match(p_team_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  live_match public.team_matches;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_team_member(p_team_id) then return null; end if;

  select * into live_match from public.team_matches
  where (home_team_id = p_team_id or away_team_id = p_team_id) and status = 'live'
  order by started_at desc limit 1;

  if live_match.id is null then return null; end if;

  return jsonb_build_object(
    'id', live_match.id,
    'challenge_id', live_match.challenge_id,
    'home_team_id', live_match.home_team_id,
    'away_team_id', live_match.away_team_id,
    'home_team', (select jsonb_build_object('id', t.id, 'name', t.name, 'tag', t.tag) from public.teams t where t.id = live_match.home_team_id),
    'away_team', (select jsonb_build_object('id', t.id, 'name', t.name, 'tag', t.tag) from public.teams t where t.id = live_match.away_team_id),
    'venue_name', (select v.name from public.team_challenges c join public.venues v on v.id = c.venue_id where c.id = live_match.challenge_id),
    'match_format', live_match.match_format,
    'scorer_id', live_match.scorer_id,
    'scorer_name', (select coalesce(p.display_name, 'Assigned scorer') from public.profiles p where p.id = live_match.scorer_id),
    'can_score', public.can_score_team_match(live_match.id),
    'can_assign_scorer', (
      live_match.scorer_id = auth.uid()
      or public.can_manage_team(live_match.home_team_id)
      or public.can_manage_team(live_match.away_team_id)
    ),
    'status', live_match.status,
    'home_score', live_match.home_score,
    'away_score', live_match.away_score,
    'server_side', live_match.server_side,
    'serving_position', live_match.serving_position,
    'service_number', live_match.service_number,
    'game', live_match.game,
    'completed_games', live_match.completed_games,
    'started_at', live_match.started_at
  );
end;
$$;

create or replace function public.handoff_team_match_scorer(p_match_id uuid, p_scorer_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  live_match public.team_matches;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into live_match from public.team_matches where id = p_match_id and status = 'live' for update;
  if live_match.id is null then raise exception 'This match is not live'; end if;
  if not (
    live_match.scorer_id = auth.uid()
    or public.can_manage_team(live_match.home_team_id)
    or public.can_manage_team(live_match.away_team_id)
  ) then
    raise exception 'Only the assigned scorer or a team manager can change the scorer';
  end if;
  if not (
    exists(select 1 from public.team_members where team_id = live_match.home_team_id and user_id = p_scorer_id)
    or exists(select 1 from public.team_members where team_id = live_match.away_team_id and user_id = p_scorer_id)
  ) then
    raise exception 'Choose a signed-in member of one of the two teams';
  end if;

  update public.team_matches set scorer_id = p_scorer_id where id = live_match.id;
  return public.get_team_match(live_match.home_team_id);
end;
$$;

create or replace function public.start_team_match(p_challenge_id uuid, p_scorer_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  challenge public.team_challenges;
  created public.team_matches;
  assigned_scorer uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into challenge from public.team_challenges where id = p_challenge_id for update;
  if challenge.id is null then raise exception 'Challenge not found'; end if;
  if challenge.status <> 'accepted' then raise exception 'This challenge has not been accepted by both teams'; end if;
  if not (public.is_team_member(challenge.challenger_team_id) or public.is_team_member(challenge.challenged_team_id)) then
    raise exception 'Only players on one of the two teams can start this match';
  end if;

  assigned_scorer := coalesce(p_scorer_id, auth.uid());
  if not (
    exists(select 1 from public.team_members where team_id = challenge.challenger_team_id and user_id = assigned_scorer)
    or exists(select 1 from public.team_members where team_id = challenge.challenged_team_id and user_id = assigned_scorer)
  ) then
    raise exception 'The assigned scorer must be a member of one of the two teams';
  end if;

  insert into public.team_matches(challenge_id, home_team_id, away_team_id, match_format, scorer_id, service_number)
  values (
    challenge.id, challenge.challenger_team_id, challenge.challenged_team_id, challenge.format, assigned_scorer,
    case when challenge.format = 'singles' then 1 else 2 end
  )
  on conflict (challenge_id) do nothing
  returning * into created;

  if created.id is null then
    select * into created from public.team_matches where challenge_id = challenge.id;
  end if;

  return public.get_team_match(created.home_team_id);
end;
$$;

create or replace function public.record_team_match_rally(p_match_id uuid, p_winning_side smallint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  live_match public.team_matches;
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

  select * into live_match from public.team_matches where id = p_match_id and status = 'live' for update;
  if live_match.id is null then raise exception 'This match is not live'; end if;
  if not public.can_score_team_match(live_match.id) then raise exception 'Only the assigned scorer can record this rally'; end if;
  if greatest(live_match.home_score, live_match.away_score) >= 11
     and abs(live_match.home_score - live_match.away_score) >= 2 then
    raise exception 'This game is ready to finish. Record the game score before the next rally.';
  end if;

  next_home := live_match.home_score;
  next_away := live_match.away_score;
  next_server := live_match.server_side;
  next_position := live_match.serving_position;
  next_service := live_match.service_number;

  if p_winning_side = live_match.server_side then
    if p_winning_side = 0 then next_home := next_home + 1; else next_away := next_away + 1; end if;
    rally_action := 'point';
    scoring_side := p_winning_side;
  elsif live_match.service_number = 1 then
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

  update public.team_matches
  set home_score = next_home, away_score = next_away, server_side = next_server,
      serving_position = next_position, service_number = next_service
  where id = p_match_id;

  insert into public.team_match_score_events(
    match_id, game, action, rally_winner_side, scoring_side, home_score, away_score,
    previous_home_score, previous_away_score, previous_server_side, previous_serving_position, previous_service_number,
    server_side, serving_position, service_number, recorded_by
  ) values (
    live_match.id, live_match.game, rally_action, p_winning_side, scoring_side, next_home, next_away,
    live_match.home_score, live_match.away_score, live_match.server_side, live_match.serving_position, live_match.service_number,
    next_server, next_position, next_service, auth.uid()
  ) returning id into event_id;

  return jsonb_build_object(
    'id', event_id, 'winning_side', p_winning_side, 'action', rally_action,
    'home_score', next_home, 'away_score', next_away,
    'server_side', next_server, 'serving_position', next_position, 'service_number', next_service,
    'game', live_match.game, 'can_undo', true
  );
end;
$$;

create or replace function public.undo_team_match_rally(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  live_match public.team_matches;
  latest_event public.team_match_score_events;
  another_event boolean;
  undo_event_id bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into live_match from public.team_matches where id = p_match_id and status = 'live' for update;
  if live_match.id is null then raise exception 'This match is not live'; end if;
  if not public.can_score_team_match(live_match.id) then raise exception 'Only the assigned scorer can undo this rally'; end if;

  select * into latest_event from public.team_match_score_events
  where match_id = p_match_id and action in ('point','second_server','side_out') and undone_at is null
  order by id desc limit 1 for update;
  if latest_event.id is null then raise exception 'There is no rally to undo'; end if;

  update public.team_matches
  set home_score = latest_event.previous_home_score, away_score = latest_event.previous_away_score,
      server_side = latest_event.previous_server_side, serving_position = latest_event.previous_serving_position,
      service_number = latest_event.previous_service_number
  where id = p_match_id;

  update public.team_match_score_events set undone_at = now(), undone_by = auth.uid() where id = latest_event.id;

  insert into public.team_match_score_events(
    match_id, game, action, rally_winner_side, home_score, away_score,
    server_side, serving_position, service_number, recorded_by
  ) values (
    p_match_id, live_match.game, 'undo', latest_event.rally_winner_side,
    latest_event.previous_home_score, latest_event.previous_away_score,
    latest_event.previous_server_side, latest_event.previous_serving_position, latest_event.previous_service_number,
    auth.uid()
  ) returning id into undo_event_id;

  select exists(
    select 1 from public.team_match_score_events
    where match_id = p_match_id and action in ('point','second_server','side_out') and undone_at is null
  ) into another_event;

  return jsonb_build_object(
    'id', undo_event_id, 'action', 'undo',
    'home_score', latest_event.previous_home_score, 'away_score', latest_event.previous_away_score,
    'server_side', latest_event.previous_server_side, 'serving_position', latest_event.previous_serving_position,
    'service_number', latest_event.previous_service_number, 'game', live_match.game, 'can_undo', another_event
  );
end;
$$;

-- Explicit step (mirrors the app's own confirm-before-advancing pattern in
-- PlayerOpenPlayScreen) rather than silently auto-advancing inside the rally
-- RPC, so a mis-tap can't roll the match into the next game unattended.
create or replace function public.complete_team_match_game(p_match_id uuid, p_home_score integer, p_away_score integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  live_match public.team_matches;
  game_winner smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_home_score = p_away_score then raise exception 'A game cannot end in a tie'; end if;

  select * into live_match from public.team_matches where id = p_match_id and status = 'live' for update;
  if live_match.id is null then raise exception 'This match is not live'; end if;
  if not public.can_score_team_match(live_match.id) then raise exception 'Only the assigned scorer can record the game result'; end if;

  game_winner := case when p_home_score > p_away_score then 0 else 1 end;

  insert into public.team_match_score_events(match_id, game, action, rally_winner_side, home_score, away_score, server_side, serving_position, service_number, recorded_by)
  values (p_match_id, live_match.game, 'game_complete', game_winner, p_home_score, p_away_score, game_winner, 0, 2, auth.uid());

  update public.team_matches
  set completed_games = completed_games || jsonb_build_array(jsonb_build_object('home', p_home_score, 'away', p_away_score)),
      home_score = 0, away_score = 0, game = live_match.game + 1,
      server_side = 1 - game_winner, serving_position = 0, service_number = 2
  where id = p_match_id;

  return public.get_team_match(live_match.home_team_id);
end;
$$;

create or replace function public.complete_team_match(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  live_match public.team_matches;
  home_games integer;
  away_games integer;
  final_winner smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into live_match from public.team_matches where id = p_match_id and status = 'live' for update;
  if live_match.id is null then raise exception 'This match is not live'; end if;
  if not public.can_score_team_match(live_match.id) then raise exception 'Only the assigned scorer can finish this match'; end if;
  if jsonb_array_length(live_match.completed_games) = 0 then raise exception 'Record at least one completed game before finishing the match'; end if;

  select count(*) filter (where (value->>'home')::int > (value->>'away')::int),
         count(*) filter (where (value->>'away')::int > (value->>'home')::int)
    into home_games, away_games
    from jsonb_array_elements(live_match.completed_games);

  final_winner := case when home_games >= away_games then 0 else 1 end;

  update public.team_matches set status = 'completed', winner_side = final_winner, ended_at = now() where id = p_match_id;
  update public.team_challenges set status = 'completed' where id = live_match.challenge_id;

  return jsonb_build_object(
    'id', live_match.id, 'status', 'completed', 'winner_side', final_winner,
    'completed_games', live_match.completed_games
  );
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['team_matches', 'team_match_score_events'] loop
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

alter table public.team_matches replica identity full;

revoke all on function public.handoff_team_match_scorer(uuid, uuid) from public, anon;
grant execute on function public.handoff_team_match_scorer(uuid, uuid) to authenticated;
